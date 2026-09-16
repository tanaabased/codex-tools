import { YAML } from 'bun';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSupplemental } from './validation-supplemental.js';

const vendor = fileURLToPath(
  new URL(
    existsSync(new URL('./vendor/openai', import.meta.url))
      ? './vendor/openai/'
      : '../vendor/openai/',
    import.meta.url,
  ),
);

export const validatorContract = Object.freeze({
  codexVersion: '0.153.4',
  revision: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
  format: 'legacy .codex-plugin/plugin.json ingestion contract',
  python: '>=3.10',
  pyYAML: '>=6,<7',
});

function execute(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0 && !result.error,
    exitCode: result.status ?? null,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function checkDescriptors(checks) {
  if (!Array.isArray(checks)) throw new TypeError('repositoryChecks must be an array.');
  const names = new Set();
  for (const check of checks) {
    if (
      !check ||
      typeof check !== 'object' ||
      Array.isArray(check) ||
      Object.keys(check).some((key) => !['name', 'command', 'args'].includes(key)) ||
      typeof check.name !== 'string' ||
      !check.name.trim() ||
      names.has(check.name) ||
      typeof check.command !== 'string' ||
      !check.command.trim() ||
      !Array.isArray(check.args) ||
      !check.args.every((arg) => typeof arg === 'string')
    ) {
      throw new TypeError(
        'Each repository check needs a unique name, command, and string args array.',
      );
    }
    names.add(check.name);
  }
}

/** Explicit checks are trusted caller-selected programs, never discovered in a plugin. */
export async function validatePlugin({
  repoRoot = process.cwd(),
  python = 'python3',
  repositoryChecks = [],
  repositoryChecksPath,
} = {}) {
  const root = await realpath(resolve(repoRoot));
  if (repositoryChecksPath) {
    if (repositoryChecks.length)
      throw new Error('Choose repositoryChecks or repositoryChecksPath, not both.');
    repositoryChecks = JSON.parse(await readFile(resolve(root, repositoryChecksPath), 'utf8'));
  }
  checkDescriptors(repositoryChecks);
  if (typeof python !== 'string' || !python.trim())
    throw new TypeError('python must name an executable.');
  const executable = python.includes('/') || python.includes('\\') ? resolve(python) : python;
  const dependency = execute(
    executable,
    [
      '-I',
      '-B',
      '-c',
      'import sys; assert sys.version_info >= (3, 10), "Python >=3.10 required"; import yaml; from importlib.metadata import version; v=version("PyYAML"); assert 6 <= int(v.split(".")[0]) < 7, "PyYAML >=6,<7 required"; print(sys.version.split()[0]); print(v)',
    ],
    vendor,
  );
  const supplemental = await validateSupplemental({ repoRoot: root, parseYaml: YAML.parse });
  const failures = [...supplemental.failures];
  let upstream = { ok: false, skipped: true, reason: 'Dependency or resource preflight failed.' };
  if (!dependency.ok) {
    failures.push(
      'Validation requires Python >=3.10 and PyYAML >=6,<7. Create a virtual environment with python3 -m venv /path/to/venv, then run /path/to/venv/bin/python -m pip install "PyYAML>=6,<7" and select --python /path/to/venv/bin/python. Nothing was installed.',
    );
  } else if (supplemental.safe !== false) {
    upstream = execute(
      executable,
      ['-I', '-B', resolve(vendor, 'validate_plugin.py'), root],
      vendor,
    );
    if (!upstream.ok) failures.push('Official plugin validator failed; see upstream diagnostics.');
  }
  const repository = [];
  for (const { name, command, args } of repositoryChecks) {
    const result = { name, ...execute(command, args, root) };
    repository.push(result);
    if (!result.ok) failures.push('Repository check failed: ' + name);
  }
  const manifest = supplemental.manifest;
  const unsupported = [];
  if (manifest && typeof manifest === 'object') {
    for (const [key, expected] of [
      ['skills', 'skills'],
      ['apps', '.app.json'],
      ['mcpServers', '.mcp.json'],
    ]) {
      const value = manifest[key];
      if (
        value == null ||
        (key === 'mcpServers' && typeof value === 'object' && !Array.isArray(value))
      )
        continue;
      if (typeof value !== 'string' || value.replace(/^\.\//, '').replace(/\/$/, '') !== expected)
        unsupported.push(key + ' format is beyond the pinned validator contract.');
    }
    const allowed = new Set([
      'id',
      'name',
      'version',
      'description',
      'skills',
      'apps',
      'mcpServers',
      'interface',
      'author',
      'homepage',
      'repository',
      'license',
      'keywords',
    ]);
    for (const key of Object.keys(manifest))
      if (!allowed.has(key)) unsupported.push('Unknown manifest field: ' + key);
  }
  failures.push(...unsupported);
  const ok = failures.length === 0 && upstream.ok;
  return {
    command: 'validate',
    source: { path: root, valid: ok },
    ok,
    status: !dependency.ok
      ? 'dependency_error'
      : unsupported.length
        ? 'unsupported'
        : ok
          ? 'valid'
          : 'invalid',
    issue: failures[0] ?? null,
    failures,
    coverage: {
      ...validatorContract,
      unsupported,
      repositoryChecks: repository.length ? 'explicit' : 'not_requested',
    },
    dependency,
    upstream,
    supplemental: {
      checks: supplemental.checks,
      failures: supplemental.failures,
      ok: supplemental.ok,
    },
    repository,
  };
}
