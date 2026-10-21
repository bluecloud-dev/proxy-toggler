import { generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { isIP } from 'node:net';

// X.509 certificates made at run time, so that no private key is ever committed. Node can sign but
// not build a certificate, so this encodes the few ASN.1 DER structures a TLS test needs.

export type Certificate = {
  cert: string;
  key: string;
  // For signing other certificates; tests pass only `cert` and `key` to TLS.
  privateKey: KeyObject;
  commonName: string;
};

type CertificateOptions = {
  commonName: string;
  // Host names or IP addresses the certificate is valid for; the common name when left out.
  altNames?: string[];
  // The certificate that signs this one; self-signed when left out.
  issuer?: Certificate;
  isAuthority?: boolean;
  notBefore?: Date;
  notAfter?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function createCertificate(options: CertificateOptions): Certificate {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signer = options.issuer ?? { privateKey, commonName: options.commonName };
  const now = Date.now();

  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(8)),
    ECDSA_WITH_SHA256,
    name(signer.commonName),
    sequence(
      time(options.notBefore ?? new Date(now - DAY_MS)),
      time(options.notAfter ?? new Date(now + 365 * DAY_MS))
    ),
    name(options.commonName),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, sequence(...extensions(options)))
  );
  const signature = sign('sha256', tbs, signer.privateKey);
  const certificate = sequence(tbs, ECDSA_WITH_SHA256, bitString(signature));

  return {
    cert: pem('CERTIFICATE', certificate),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    privateKey,
    commonName: options.commonName
  };
}

function extensions(options: CertificateOptions): Buffer[] {
  const basicConstraints = sequence(
    oid('2.5.29.19'),
    boolean(true),
    octetString(options.isAuthority ? sequence(boolean(true)) : sequence())
  );
  if (options.isAuthority) {
    return [basicConstraints];
  }

  const altNames = (options.altNames ?? [options.commonName]).map((altName) =>
    isIP(altName) === 4
      ? element(0x87, Buffer.from(altName.split('.').map(Number)))
      : element(0x82, Buffer.from(altName, 'ascii'))
  );
  return [basicConstraints, sequence(oid('2.5.29.17'), octetString(sequence(...altNames)))];
}

const ECDSA_WITH_SHA256 = sequenceOf([oidBytes('1.2.840.10045.4.3.2')]);

function name(commonName: string): Buffer {
  return sequence(set(sequence(oid('2.5.4.3'), element(0x0c, Buffer.from(commonName, 'utf8')))));
}

// UTCTime before 2050 and GeneralizedTime from then on, as RFC 5280 requires.
function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return date.getUTCFullYear() < 2050
    ? element(0x17, Buffer.from(`${iso.slice(2)}Z`, 'ascii'))
    : element(0x18, Buffer.from(`${iso}Z`, 'ascii'));
}

function pem(label: string, der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function sequence(...items: Buffer[]): Buffer {
  return sequenceOf(items);
}

function sequenceOf(items: Buffer[]): Buffer {
  return element(0x30, Buffer.concat(items));
}

function set(...items: Buffer[]): Buffer {
  return element(0x31, Buffer.concat(items));
}

function explicit(tagNumber: number, content: Buffer): Buffer {
  return element(0xa0 + tagNumber, content);
}

function integer(value: Buffer): Buffer {
  // A leading zero keeps a value whose top bit is set positive.
  return element(0x02, (value[0] ?? 0) >= 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}

function boolean(value: boolean): Buffer {
  return element(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function bitString(value: Buffer): Buffer {
  return element(0x03, Buffer.concat([Buffer.from([0]), value]));
}

function octetString(value: Buffer): Buffer {
  return element(0x04, value);
}

function oid(dotted: string): Buffer {
  return oidBytes(dotted);
}

function oidBytes(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const base128: number[] = [];
    let value = arc;
    do {
      base128.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    } while (value > 0);
    bytes.push(...base128.map((byte, index) => (index < base128.length - 1 ? byte | 0x80 : byte)));
  }
  return element(0x06, Buffer.from(bytes));
}

function element(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

function length(value: number): Buffer {
  if (value < 0x80) {
    return Buffer.from([value]);
  }
  const bytes: number[] = [];
  for (let remaining = value; remaining > 0; remaining = Math.floor(remaining / 256)) {
    bytes.unshift(remaining & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
