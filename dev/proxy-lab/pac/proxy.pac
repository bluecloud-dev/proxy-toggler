// Proxy auto-config file for the Proxy Toggler lab. The client evaluates it on the host, so it
// returns the addresses that compose.yaml publishes there.
function FindProxyForURL(url, host) {
  // The lab origin resolves only inside the Docker network, so only a proxy can reach it.
  if (dnsDomainIs(host, '.lab.test')) {
    return 'PROXY 127.0.0.1:3128';
  }
  // VS Code's own Marketplace traffic goes to the proxy that asks for credentials.
  if (dnsDomainIs(host, '.visualstudio.com') || dnsDomainIs(host, '.vsassets.io')) {
    return 'PROXY 127.0.0.1:3129';
  }
  return 'DIRECT';
}
