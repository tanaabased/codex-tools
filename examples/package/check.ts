import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { checkDocumentationLinks, documentationExample } from '../../dev/lib/documentation.ts';
import packageJson from '../../package.json';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const [tarball, inventory, consumer] = process.argv.slice(2);
assert.ok(tarball && inventory && consumer, 'expected tarball, pack inventory, and consumer');
const [packed] = JSON.parse(await readFile(inventory, 'utf8')) as Array<{
  shasum: string;
  files: Array<{ path: string }>;
}>;
assert.ok(packed);
const installed = path.join(consumer, 'node_modules/@tanaab/codex-tools');
const declarationSources = (
  await Promise.all(
    ['lib', 'utils'].map(async (directory) =>
      (await readdir(path.join(repo, directory), { recursive: true }))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => path.join(directory, file).split(path.sep).join('/')),
    ),
  )
).flat();
const declarations = declarationSources.flatMap((file) => [
  `dist/esm/${file.replace(/\.ts$/, '.d.ts')}`,
  `dist/cjs/${file.replace(/\.ts$/, '.d.cts')}`,
]);
const allowed = new Set([
  'package.json',
  '.codex-plugin/plugin.json',
  'assets/composer-icon.svg',
  'assets/icon-large.png',
  'assets/codex-tools.png',
  'API.md',
  'ADVANCED.md',
  'CLI.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'README.md',
  'LICENSE',
  'NOTICE',
  'PLUGINS.md',
  'dist/codex-tools',
  'dist/esm/index.js',
  'dist/cjs/index.cjs',
  'skills/codex-tools-maintenance/SKILL.md',
  'skills/codex-tools-maintenance/agents/openai.yaml',
  'skills/codex-tools-maintenance/assets/icon-large.png',
  'skills/codex-tools-maintenance/assets/icon-small.svg',
  'skills/codex-tools-setup/SKILL.md',
  'skills/codex-tools-setup/agents/openai.yaml',
  'skills/codex-tools-setup/assets/icon-large.png',
  'skills/codex-tools-setup/assets/icon-small.svg',
  ...declarations,
]);

assert.deepEqual(new Set(packed.files.map((file) => file.path)), allowed);
assert.equal((await lstat(installed)).isSymbolicLink(), false);
assert.equal(await realpath(installed), installed);
await checkDocumentationLinks(installed, [
  'README.md',
  'CLI.md',
  'API.md',
  'ADVANCED.md',
  'CONTRIBUTING.md',
  'PLUGINS.md',
]);
const apiExample = documentationExample(
  await readFile(path.join(installed, 'README.md'), 'utf8'),
  'api',
);
const commonjsExample = documentationExample(
  await readFile(path.join(installed, 'API.md'), 'utf8'),
  'api-commonjs',
);
const plugin = JSON.parse(
  await readFile(path.join(installed, '.codex-plugin/plugin.json'), 'utf8'),
) as {
  name: string;
  version: string;
  skills: string;
  interface: { composerIcon: string; logo: string };
};
assert.equal(plugin.name, 'codex-tools');
assert.equal(plugin.version, packageJson.version);
assert.equal(plugin.skills, './skills/');
for (const asset of [plugin.interface.composerIcon, plugin.interface.logo])
  await lstat(path.join(installed, asset));
for (const skill of ['codex-tools-setup', 'codex-tools-maintenance']) {
  const skillRoot = path.join(installed, 'skills', skill);
  const instructions = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const agent = await readFile(path.join(skillRoot, 'agents/openai.yaml'), 'utf8');
  assert.ok(instructions.includes(`name: tanaab-${skill}`));
  assert.ok(instructions.includes('<plugin-root>/dist/codex-tools'));
  assert.ok(agent.includes("icon_small: './assets/icon-small.svg'"));
  assert.ok(agent.includes("icon_large: './assets/icon-large.png'"));
}
for (const absent of ['bin', 'lib', 'dev', 'test', 'utils'])
  await assert.rejects(lstat(path.join(installed, absent)), { code: 'ENOENT' });
const executable = path.join(installed, 'dist/codex-tools');
assert.ok((await readFile(executable, 'utf8')).startsWith('#!/usr/bin/env node\n'));
assert.notEqual((await lstat(executable)).mode & 0o111, 0);

const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8')) as {
  version: string;
  engines: Record<string, string>;
  main: string;
  module: string;
  types: string;
  exports: Record<string, unknown>;
};
assert.equal(metadata.version, plugin.version);
assert.deepEqual(metadata.engines, { node: '^24.15.0 || >=26.0.0' });
assert.equal(metadata.main, './dist/cjs/index.cjs');
assert.equal(metadata.module, './dist/esm/index.js');
assert.equal(metadata.types, './dist/esm/lib/index.d.ts');
assert.deepEqual(metadata.exports, {
  '.': {
    import: {
      types: './dist/esm/lib/index.d.ts',
      default: './dist/esm/index.js',
    },
    require: {
      types: './dist/cjs/lib/index.d.cts',
      default: './dist/cjs/index.cjs',
    },
  },
});
for (const target of [metadata.main, metadata.module, metadata.types, './dist/cjs/lib/index.d.cts'])
  await lstat(path.join(installed, target));

await writeFile(path.join(consumer, 'types.mts'), apiExample);
await writeFile(path.join(consumer, 'documented.cjs'), commonjsExample);
assert.equal(
  createHash('sha1')
    .update(await readFile(tarball))
    .digest('hex'),
  packed.shasum,
);
process.stdout.write('Verified packed contents, metadata, resources, and documentation.\n');
