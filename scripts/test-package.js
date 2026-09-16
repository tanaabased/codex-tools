import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), 'codex-tools-package-'));
try {
  const env = { ...process.env, npm_config_cache: path.join(root, 'npm-cache') };
  const inspected = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: repo,
      env,
      encoding: 'utf8',
    }),
  )[0];
  const allowed = new Set([
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
    'dist/codex-tools',
    'dist/index.js',
  ]);
  assert.deepEqual(new Set(inspected.files.map((file) => file.path)), allowed);
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      cwd: repo,
      env,
      encoding: 'utf8',
    }),
  )[0];
  execFileSync('tar', ['-xzf', path.join(root, packed.filename), '-C', root]);
  const executable = path.join(root, 'package/dist/codex-tools');
  assert.ok((await readFile(executable, 'utf8')).startsWith('#!/usr/bin/env bun\n'));
  for (const [flag, expected] of [
    ['--help', 'Usage:'],
    ['--version', packageJson.version],
  ]) {
    const result = spawnSync(executable, [flag], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(expected), result.stdout);
    assert.equal(result.stderr, '');
  }
  const api = await import(path.join(root, 'package/dist/index.js'));
  assert.equal(typeof api.runOperation, 'function');
  assert.equal(typeof api.refreshPlugin, 'function');
  process.stdout.write(
    'Package allowlist, Bun shebang, executable help/version, and wrapper exports passed outside checkout.\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
