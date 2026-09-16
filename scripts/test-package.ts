import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import packageJson from '../package.json';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const destination = args
  .find((arg) => arg.startsWith('--pack-destination='))
  ?.split('=')
  .slice(1)
  .join('=');
if (args.some((arg) => !arg.startsWith('--pack-destination=')))
  throw new Error('Usage: test-package [--pack-destination=directory]');
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
  shasum: string;
  files: Array<{ path: string }>;
}

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-package-')));
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

  const packDirectory = destination ? path.resolve(repo, destination) : root;
  await mkdir(packDirectory, { recursive: true });
  const packed = (
    JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
        { cwd: repo, env, encoding: 'utf8' },
      ),
    ) as PackResult[]
  )[0]!;
  const tarball = path.join(packDirectory, packed.filename);

  const consumer = path.join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  const typescriptVersion = packageJson.devDependencies.typescript.replace(/^[~^]/, '');
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      tarball,
      'typescript@' + typescriptVersion,
    ],
    { cwd: consumer, env, encoding: 'utf8' },
  );

  const installed = path.join(consumer, 'node_modules/@tanaab/codex-tools');
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal(await realpath(installed), installed);
  for (const absent of ['bin', 'lib', 'scripts', 'test', 'utils'])
    await assert.rejects(lstat(path.join(installed, absent)), { code: 'ENOENT' });
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
  ])
    await lstat(path.join(installed, target));

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

  await writeFile(
    path.join(consumer, 'types.mts'),
    `import { runOperation, type CacheOperationResult, type CodexToolsOptions } from '@tanaab/codex-tools';
const options: CodexToolsOptions = { repoRoot: '/source', cachePathOverride: '/cache' };
const result: Promise<CacheOperationResult> = runOperation('check', options);
void result;
`,
  );
  await writeFile(
    path.join(consumer, 'types.cts'),
    `import tools = require('@tanaab/codex-tools');
import type { CacheOperationResult, CodexToolsOptions } from '@tanaab/codex-tools';
const options: CodexToolsOptions = { repoRoot: '/source', cachePathOverride: '/cache' };
const result: Promise<CacheOperationResult> = tools.runOperation('check', options);
void result;
`,
  );
  const typescript = path.join(consumer, 'node_modules/typescript/bin/tsc');
  for (const resolution of ['Node16', 'NodeNext']) {
    await writeFile(
      path.join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: resolution,
          moduleResolution: resolution,
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
        },
        files: ['types.mts', 'types.cts'],
      }),
    );
    const result = spawnSync(node, [typescript, '--project', 'tsconfig.json'], {
      cwd: consumer,
      encoding: 'utf8',
      env: nodeOnlyEnv,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const safetyConsumer = path.join(consumer, 'safety.mjs');
  await writeFile(
    safetyConsumer,
    `import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runOperation } from '@tanaab/codex-tools';
const root = process.argv[2];
const source = path.join(root, 'source');
const target = path.join(root, 'target');
const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
await writeJson(path.join(source, 'package.json'), {
  version: '1.0.0',
  codexTools: { managedPaths: ['managed.txt'] },
});
await writeJson(path.join(source, '.codex-plugin/plugin.json'), { name: 'sample', version: '1.0.0' });
await writeFile(path.join(source, 'managed.txt'), 'source');
await mkdir(target);
await writeFile(path.join(target, 'unmanaged.txt'), 'preserve');
const options = {
  repoRoot: source,
  cachePathOverride: target,
  codexHome: path.join(root, 'codex'),
  missingTarget: 'create',
};
const preview = await runOperation('sync', { ...options, dryRun: true });
assert.equal(preview.status, 'planned');
await assert.rejects(lstat(path.join(target, 'managed.txt')), { code: 'ENOENT' });
assert.equal(await readFile(path.join(target, 'unmanaged.txt'), 'utf8'), 'preserve');
assert.equal((await runOperation('sync', options)).status, 'synchronized_directory');
assert.equal((await runOperation('check', options)).status, 'synchronized_directory');
const before = await lstat(path.join(target, 'managed.txt'));
assert.equal((await runOperation('sync', options)).ok, true);
const after = await lstat(path.join(target, 'managed.txt'));
assert.equal(after.ino, before.ino);
assert.equal(after.mtimeMs, before.mtimeMs);
assert.equal(await readFile(path.join(target, 'unmanaged.txt'), 'utf8'), 'preserve');
`,
  );
  const safetyRoot = path.join(root, 'library-safety');
  const safety = spawnSync(node, [safetyConsumer, safetyRoot], {
    cwd: consumer,
    encoding: 'utf8',
    env: nodeOnlyEnv,
  });
  assert.equal(safety.status, 0, safety.stderr || safety.stdout);

  const cliRoot = path.join(root, 'cli-safety');
  const cliSource = path.join(cliRoot, 'source');
  const cliTarget = path.join(cliRoot, 'target');
  await mkdir(path.join(cliSource, '.codex-plugin'), { recursive: true });
  await mkdir(cliTarget, { recursive: true });
  await writeFile(
    path.join(cliSource, 'package.json'),
    JSON.stringify({ version: '1.0.0', codexTools: { managedPaths: ['managed.txt'] } }),
  );
  const manifest = JSON.stringify({ name: 'sample', version: '1.0.0' });
  await writeFile(path.join(cliSource, '.codex-plugin/plugin.json'), manifest);
  await writeFile(path.join(cliSource, 'managed.txt'), 'source');
  await writeFile(path.join(cliTarget, 'unmanaged.txt'), 'preserve');
  const common = [
    '--repo-root',
    cliSource,
    '--cache-path',
    cliTarget,
    '--missing-target',
    'create',
    '--json',
  ];
  const invoke = (operation: readonly string[], extra: readonly string[] = []) =>
    spawnSync(executable, [...operation, ...common, ...extra], {
      cwd: consumer,
      encoding: 'utf8',
      env: { ...nodeOnlyEnv, HOME: cliRoot, CODEX_HOME: path.join(cliRoot, 'codex') },
    });
  const preview = invoke(['cache', 'sync'], ['--dry-run']);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.equal(JSON.parse(preview.stdout).status, 'planned');
  await assert.rejects(lstat(path.join(cliTarget, 'managed.txt')), { code: 'ENOENT' });
  assert.equal(invoke(['cache', 'sync']).status, 0);
  assert.equal(invoke(['cache', 'check']).status, 0);
  assert.equal(await readFile(path.join(cliTarget, 'unmanaged.txt'), 'utf8'), 'preserve');

  const ambiguousHome = path.join(root, 'ambiguous-codex');
  for (const marketplace of ['one', 'two']) {
    const target = path.join(ambiguousHome, 'plugins/cache', marketplace, 'sample/1.0.0');
    await mkdir(path.join(target, '.codex-plugin'), { recursive: true });
    await writeFile(path.join(target, '.codex-plugin/plugin.json'), manifest);
    await writeFile(path.join(target, 'managed.txt'), 'old');
  }
  const ambiguous = spawnSync(
    executable,
    ['cache', 'sync', '--repo-root', cliSource, '--codex-home', ambiguousHome, '--json'],
    { cwd: consumer, encoding: 'utf8', env: { ...nodeOnlyEnv, HOME: cliRoot } },
  );
  assert.equal(ambiguous.status, 1, ambiguous.stderr || ambiguous.stdout);
  assert.equal(JSON.parse(ambiguous.stdout).status, 'unresolved');
  assert.equal(
    await readFile(path.join(ambiguousHome, 'plugins/cache/one/sample/1.0.0/managed.txt'), 'utf8'),
    'old',
  );

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
  assert.equal(
    createHash('sha1')
      .update(await readFile(tarball))
      .digest('hex'),
    packed.shasum,
    'Release the same tarball that passed consumer verification.',
  );
  process.stdout.write(
    `Verified ${tarball}: exact contents, Node-only CLI, runtime and TypeScript ESM/CommonJS consumers, installed safety contracts, and direct Bun source command.\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
