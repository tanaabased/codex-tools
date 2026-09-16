import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, put } from '../test/validation-fixture.js';
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
    'validation.md',
    'dist/vendor/openai/validate_plugin.py',
    'dist/vendor/openai/identifier_validation.py',
    'dist/vendor/openai/LICENSE',
    'dist/vendor/openai/NOTICE',
    'dist/vendor/openai/provenance.json',
    'dist/vendor/openai/requirements.txt',
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
  const plugin = await fixture();
  try {
    const python = process.env.CODEX_TOOLS_PYTHON ?? 'python3';
    const valid = spawnSync(
      executable,
      ['validate', '--repo-root', plugin.root, '--python', python, '--json'],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    assert.equal(JSON.parse(valid.stdout).upstream.exitCode, 0);
    assert.equal((await api.validatePlugin({ repoRoot: plugin.root, python })).ok, true);
    await put(plugin.root, '.codex-plugin/plugin.json', '{');
    const invalid = spawnSync(
      executable,
      ['validate', '--repo-root', plugin.root, '--python', python, '--json'],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(invalid.status, 1, invalid.stdout);
    assert.equal(JSON.parse(invalid.stdout).upstream.exitCode, 1);
    const missing = spawnSync(
      executable,
      [
        'validate',
        '--repo-root',
        plugin.root,
        '--python',
        path.join(root, 'missing-python'),
        '--json',
      ],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(missing.status, 2);
  } finally {
    await rm(plugin.root, { recursive: true, force: true });
  }
  process.stdout.write(
    'Package allowlist, Bun shebang, executable help/version, wrapper exports, and standalone validation passed outside checkout.\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
