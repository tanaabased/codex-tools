import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCLI } from '../lib/run-cli.ts';
import packageJson from '../package.json';
import { parseArgs } from '../utils/parse-args.ts';

async function invoke(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = '';
  let stderr = '';
  const status = await runCLI(args, {
    env,
    stdout: {
      isTTY: true,
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
  });
  return { status, stdout, stderr };
}

describe('lib/run-cli', () => {
  for (const args of [
    ['cache', 'sync', '--unknown'],
    ['cache', 'sync', '--repo-root'],
    ['cache', 'sync', '--dry-run=true'],
    ['cache', 'sync', '--json=1'],
    ['status', 'extra'],
    ['cache', 'other'],
    ['--help', '--unknown'],
    ['cache', 'sync', '--repo-root', 'one', '--repo-root', 'two'],
    ['status', '--dry-run'],
  ]) {
    it('should reject invalid arguments during parsing: ' + args.join(' '), () => {
      assert.throws(() => parseArgs(args, {}));
    });
  }

  it('should apply flags over environment and support explicit boolean negation', () => {
    const parsed = parseArgs(['cache', 'sync', '--repo-root', '/cli', '--no-debug', '--no-json'], {
      CODEX_TOOLS_REPO_ROOT: '/env',
      CODEX_HOME: '/home',
      CODEX_TOOLS_DEBUG: 'true',
      CODEX_TOOLS_JSON: 'true',
    });
    assert.equal(parsed.repoRoot, '/cli');
    assert.equal(parsed.codexHome, '/home');
    assert.equal(parsed.debug, false);
    assert.equal(parsed.json, false);
    assert.equal(parseArgs(['status'], { CODEX_TOOLS_REPO_ROOT: '/env' }).repoRoot, '/env');
  });

  it('should report malformed source metadata without writing the cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-tools-cli-'));
    try {
      const repo = path.join(root, 'source');
      const cache = path.join(root, 'cache');
      await mkdir(path.join(repo, '.codex-plugin'), { recursive: true });
      await writeFile(path.join(repo, '.codex-plugin/plugin.json'), '{');
      const result = await invoke(
        [
          'cache',
          'sync',
          '--repo-root',
          repo,
          '--cache-path',
          cache,
          '--missing-target',
          'create',
          '--json',
        ],
        { HOME: root, CODEX_HOME: path.join(root, 'codex') },
      );
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).status, 'error');
      assert.equal(JSON.parse(result.stdout).source.valid, false);
      await assert.rejects(lstat(cache), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should keep JSON help color-free on a terminal stream', async () => {
    const result = await invoke(['--help', '--json']);
    assert.equal(result.status, 0);
    assert.match(JSON.parse(result.stdout).help, /Usage: codex-tools/);
    assert.ok(!result.stdout.includes('\\u001b'));
  });

  it('should return an exit code without changing process exit state', async () => {
    const before = process.exitCode;
    const result = await invoke(['--version']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), packageJson.version);
    assert.equal(result.stderr, '');
    assert.equal(process.exitCode, before);
  });

  it('should preserve environment-selected JSON and diagnostics on argument failure', async () => {
    const result = await invoke(['--unknown'], { CODEX_TOOLS_JSON: 'true' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.match(result.stderr, /error:/);
  });
});
