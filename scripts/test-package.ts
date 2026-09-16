import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import packageJson from '../package.json';

const repo = fileURLToPath(new URL('..', import.meta.url));
const runtimeExports = [
  'collectEntries',
  'diffEntries',
  'inspectInstallation',
  'inspectTrees',
  'installPlugin',
  'refreshPlugin',
  'resolveContext',
  'runCLI',
  'runOperation',
  'syncEntries',
] as const;

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
}

const root = await mkdtemp(path.join(tmpdir(), 'codex-tools-package-'));
try {
  const env = { ...process.env, npm_config_cache: path.join(root, 'npm-cache') };
  const inspected = (
    JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
        cwd: repo,
        env,
        encoding: 'utf8',
      }),
    ) as PackResult[]
  )[0]!;
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
    'README.md',
    'LICENSE',
    'NOTICE',
    'dist/codex-tools',
    'dist/esm/index.js',
    'dist/cjs/index.cjs',
    ...declarations,
  ]);
  assert.deepEqual(new Set(inspected.files.map((file) => file.path)), allowed);
  const packed = (
    JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
        cwd: repo,
        env,
        encoding: 'utf8',
      }),
    ) as PackResult[]
  )[0]!;
  execFileSync('tar', ['-xzf', path.join(root, packed.filename), '-C', root]);

  const consumer = path.join(root, 'consumer');
  const installed = path.join(consumer, 'node_modules/@tanaab/codex-tools');
  await mkdir(path.dirname(installed), { recursive: true });
  await rename(path.join(root, 'package'), installed);
  const executable = path.join(installed, 'dist/codex-tools');
  assert.ok((await readFile(executable, 'utf8')).startsWith('#!/usr/bin/env node\n'));
  assert.notEqual((await lstat(executable)).mode & 0o111, 0);

  const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8')) as {
    engines: Record<string, string>;
    main: string;
    module: string;
    types: string;
    exports: Record<string, unknown>;
  };
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
  for (const target of [
    metadata.main,
    metadata.module,
    metadata.types,
    './dist/cjs/lib/index.d.cts',
  ]) {
    await lstat(path.join(installed, target));
  }

  const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
  const nodeBin = path.join(root, 'node-bin');
  await mkdir(nodeBin);
  await symlink(node, path.join(nodeBin, 'node'));
  const nodeOnlyEnv = { ...env, PATH: nodeBin };
  for (const [flag, expected] of [
    ['--help', 'Usage:'],
    ['--version', packageJson.version],
  ] satisfies Array<[string, string]>) {
    const result = spawnSync(executable, [flag], {
      cwd: consumer,
      encoding: 'utf8',
      env: { ...nodeOnlyEnv, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(expected), result.stdout);
    assert.equal(result.stderr, '');
  }
  for (const output of [[], ['--json']]) {
    const result = spawnSync(
      executable,
      ['install', 'npm:@fixture/plugin@^1.0.0', '--dry-run', ...output],
      {
        cwd: consumer,
        encoding: 'utf8',
        env: {
          ...nodeOnlyEnv,
          HOME: root,
          CODEX_HOME: path.join(root, 'codex'),
          NO_COLOR: '1',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    if (output.length) {
      const data = JSON.parse(result.stdout);
      assert.equal(data.source.valid, null);
      assert.equal(data.source.package, '@fixture/plugin');
      assert.deepEqual(data.native, []);
    } else assert.match(result.stdout, /status: planned/);
  }

  const esmConsumer = path.join(consumer, 'consumer.mjs');
  const cjsConsumer = path.join(consumer, 'consumer.cjs');
  const expectedExports = JSON.stringify([...runtimeExports].sort());
  await writeFile(
    esmConsumer,
    `import assert from 'node:assert/strict';\nimport * as api from '@tanaab/codex-tools';\nassert.deepEqual(Object.keys(api).sort(), ${expectedExports});\n`,
  );
  await writeFile(
    cjsConsumer,
    `const assert = require('node:assert/strict');\nconst api = require('@tanaab/codex-tools');\nassert.deepEqual(Object.keys(api).sort(), ${expectedExports});\n`,
  );
  for (const consumerFile of [esmConsumer, cjsConsumer]) {
    const result = spawnSync(node, [consumerFile], {
      cwd: consumer,
      encoding: 'utf8',
      env: nodeOnlyEnv,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const bunBin = path.join(root, 'bun-bin');
  await mkdir(bunBin);
  await symlink(process.execPath, path.join(bunBin, 'bun'));
  const bunSource = spawnSync(process.execPath, ['run', 'codex-tools', '--version'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...env, PATH: bunBin },
  });
  assert.equal(bunSource.status, 0, bunSource.stderr);
  assert.equal(bunSource.stdout.trim(), packageJson.version);
  process.stdout.write(
    'Package allowlist, Node-only CLI, ESM/CommonJS exports, declarations, npm dry runs, and direct Bun source command passed outside checkout.\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
