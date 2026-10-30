import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { CONTEXT_KEYS } from '../../src/commands/command-ids';

type Step = {
  id: string;
  title: string;
  description: string;
  media: { markdown?: string };
  completionEvents?: string[];
};

type Manifest = {
  files: string[];
  contributes: {
    commands: { command: string }[];
    configuration: { properties: Record<string, unknown> };
    walkthroughs?: { title: string; description: string; steps: Step[] }[];
  };
};

const root = path.join(__dirname, '..', '..');
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = readJson('package.json') as Manifest;
const strings = readJson('package.nls.json') as Record<string, string>;
const walkthroughs = manifest.contributes.walkthroughs ?? [];
const steps = walkthroughs.flatMap((walkthrough) => walkthrough.steps);

const nlsKey = (value: string): string | undefined => /^%(.+)%$/.exec(value)?.[1];
const localized = (value: string): string => strings[nlsKey(value) ?? ''] ?? value;

// A typo in any of these leaves a step that shows a raw key, never checks off, or shows nothing,
// and VS Code reports no error.
describe('walkthrough', () => {
  it('sets up a profile first, then terminals and project defaults, in five steps', () => {
    assert.equal(walkthroughs.length, 1);
    assert.deepEqual(
      steps.map((step) => step.id),
      ['addProfile', 'toggle', 'switchProfile', 'terminals', 'projectDefault']
    );
  });

  it('has a string for every localized title and description', () => {
    const values = walkthroughs.flatMap((walkthrough) => [
      walkthrough.title,
      walkthrough.description,
      ...walkthrough.steps.flatMap((step) => [step.title, step.description])
    ]);

    for (const key of values.map(nlsKey)) {
      assert.ok(key === undefined || key in strings, `package.nls.json has no ${key}`);
    }
  });

  it('runs only commands the extension contributes, or the Settings editor', () => {
    const known = new Set([
      ...manifest.contributes.commands.map(({ command }) => command),
      'workbench.action.openSettings'
    ]);

    for (const step of steps) {
      const buttons = [...localized(step.description).matchAll(/\]\(command:([^?)]+)/g)];
      const events = (step.completionEvents ?? []).filter((event) =>
        event.startsWith('onCommand:')
      );

      assert.ok(buttons.length > 0, `${step.id} has no button`);
      for (const command of [
        ...buttons.map((match) => match[1]),
        ...events.map((event) => event.slice('onCommand:'.length))
      ]) {
        assert.ok(known.has(command ?? ''), `${step.id} runs ${command}`);
      }
    }
  });

  it('checks a step off only on a command, a setting or a context key the extension owns', () => {
    const owned: Record<string, string[]> = {
      onCommand: manifest.contributes.commands.map(({ command }) => command),
      onSettingChanged: Object.keys(manifest.contributes.configuration.properties),
      onContext: Object.values(CONTEXT_KEYS)
    };

    for (const step of steps) {
      // Without completion events, a step checks off when its button is clicked.
      assert.ok(step.completionEvents?.length, `${step.id} has no completion event`);
      for (const event of step.completionEvents) {
        const [kind = '', id = ''] = event.split(/:(.*)/);
        assert.ok(owned[kind]?.includes(id), `${step.id} checks off on ${event}`);
      }
    }
  });

  it('shows a packaged Markdown page for every step', () => {
    for (const step of steps) {
      const page = step.media.markdown;

      assert.ok(page, `${step.id} has no Markdown page`);
      assert.ok(existsSync(path.join(root, page)), `${step.id}'s page ${page} does not exist`);
      assert.ok(
        manifest.files.some((glob) => path.matchesGlob(page, glob)),
        `${page} is not packaged`
      );
    }
  });
});
