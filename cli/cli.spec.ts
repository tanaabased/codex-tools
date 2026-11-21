import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import packageJson from '../package.json';
import { parseArgs } from './parse-args.ts';
import { runCLI } from './run-cli.ts';

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

describe('cli/run-cli', () => {
  for (const args of [
    ['cache', 'sync', '--unknown'],
    ['cache', 'sync', '--repo-root'],
    ['cache', 'sync', '--dry-run=true'],
    ['cache', 'sync', '--json=1'],
    ['status', 'extra'],
    ['cache', 'other'],
    ['cache', 'sync', 'extra'],
    ['doctor', 'extra'],
    ['install', ''],
    ['cloud', 'package', ''],
    ['cache sync'],
    ['cloud package'],
    ['unknown', 'install'],
    ['cloud', 'package', 'one.js', 'two.js'],
    ['cloud', 'verify'],
    ['cloud', 'verify', '--package'],
    ['cloud', 'verify', '--package', 'one', '--package', 'two'],
    ['cloud', 'package', '--dry-run'],
    ['cloud', 'package', '--package', 'release'],
    ['status', '--package', 'release'],
    ['--help', '--unknown'],
    ['cache', 'sync', '--repo-root', 'one', '--repo-root', 'two'],
    ['status', '--dry-run'],
    ['status', '--no-debug'],
    ['status', '--debug='],
    ['status', '--debug=sometimes'],
    ['status', '--debug', '--debug=false'],
  ]) {
    it('should reject invalid arguments during parsing: ' + args.join(' '), () => {
      assert.throws(() => parseArgs(args, {}));
    });
  }

  it('resolves only declared command paths in each namespace', () => {
    const names = ['install', 'refresh', 'status', 'doctor', 'check', 'sync', 'package', 'verify'];
    for (const [group, allowed] of Object.entries({
      '': ['install', 'refresh', 'status', 'doctor'],
      cache: ['check', 'sync'],
      cloud: ['package', 'verify'],
    })) {
      for (const name of names) {
        const words = group ? [group, name] : [name];
        if (allowed.includes(name)) {
          const parsed = parseArgs(
            name === 'verify' ? [...words, '--package', 'release'] : words,
            {},
          );
          assert.equal(parsed.command, group === 'cloud' ? words.join(' ') : name);
        } else {
          assert.throws(() => parseArgs(words, {}), /Unknown command/);
        }
      }
    }
    for (const name of ['cache', 'cloud', 'constructor'])
      assert.throws(() => parseArgs([name], {}), /Unknown command/);
    assert.equal(parseArgs(['install', 'refresh'], {}).repoRoot, 'refresh');
    assert.equal(parseArgs(['cloud', 'package', 'verify'], {}).configPath, 'verify');
  });

  it('should keep an explicit cloud config separate from the extracted package directory', () => {
    const parsed = parseArgs(['cloud', 'verify', 'release.mjs', '--package=packed release'], {});
    assert.equal(parsed.command, 'cloud verify');
    assert.equal(parsed.configPath, 'release.mjs');
    assert.equal(parsed.packageDirectory, 'packed release');
  });

  it('should apply flags over environment and support explicit boolean negation', () => {
    const parsed = parseArgs(
      ['cache', 'sync', '--repo-root', '/cli', '--debug=false', '--no-json'],
      {
        CODEX_TOOLS_REPO_ROOT: '/env',
        CODEX_HOME: '/home',
        CODEX_TOOLS_DEBUG: 'true',
        CODEX_TOOLS_JSON: 'true',
      },
    );
    assert.equal(parsed.repoRoot, '/cli');
    assert.equal(parsed.codexHome, '/home');
    assert.equal(parsed.debug, false);
    assert.equal(parsed.json, false);
    assert.equal(parseArgs(['status'], { CODEX_TOOLS_REPO_ROOT: '/env' }).repoRoot, '/env');
  });

  it('should disable inherited debug with a falsy value without consuming command arguments', () => {
    for (const args of [['--debug=false'], ['--debug=0'], ['--debug', 'false'], ['--debug', '0']]) {
      const parsed = parseArgs([...args, 'status'], {
        CODEX_TOOLS_DEBUG: 'true',
        RUNNER_DEBUG: '1',
      });
      assert.equal(parsed.command, 'status');
      assert.equal(parsed.debug, false);
    }
    assert.equal(parseArgs(['--debug', 'status'], { CODEX_TOOLS_DEBUG: 'false' }).debug, true);
    assert.equal(
      parseArgs(['status', '--debug=false'], { CODEX_TOOLS_DEBUG: 'invalid' }).debug,
      false,
    );
    assert.equal(parseArgs(['install', 'false', '--debug'], {}).repoRoot, 'false');
  });

  it('should ignore unrelated debug controls and let scoped settings override CI', () => {
    assert.equal(parseArgs(['status'], { TANAAB_DEBUG: 'on' }).debug, false);
    assert.equal(parseArgs(['status'], { RUNNER_DEBUG: '1' }).debug, true);
    assert.equal(
      parseArgs(['status'], { RUNNER_DEBUG: '1', CODEX_TOOLS_DEBUG: 'false' }).debug,
      false,
    );
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
    assert.match(
      JSON.parse(result.stdout).help,
      /Usage: .*codex-tools <command> \[source\] \[options\]/,
    );
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
