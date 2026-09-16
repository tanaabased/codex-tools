import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../utils/parse-args.ts';
import { runCLI } from '../lib/run-cli.ts';
import packageJson from '../package.json';

const cli = fileURLToPath(new URL('../bin/codex-tools.ts', import.meta.url));
describe('CLI contract', () => {
  let root = '';
  let repo = '';
  let cache = '';
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: root,
        CODEX_HOME: path.join(root, 'codex'),
        FORCE_COLOR: '1',
      },
    });
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codex-tools-cli-'));
    repo = path.join(root, 'source');
    cache = path.join(root, 'cache');
    await mkdir(path.join(repo, '.codex-plugin'), { recursive: true });
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await writeFile(
      path.join(repo, '.codex-plugin/plugin.json'),
      JSON.stringify({ name: 'sample', version: '1.0.0' }),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prints help and version outside the checkout', () => {
    const help = invoke('--help');
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:.*codex-tools/);
    assert.equal(help.stderr, '');
    const version = invoke('--version');
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), packageJson.version);
  });
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
    it('rejects invalid input before effects: ' + args.join(' '), async () => {
      const result = invoke(...args, '--json');
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).ok, false);
      assert.match(result.stderr, /error:/);
      await assert.rejects(lstat(cache), { code: 'ENOENT' });
    });
  }
  it('retains neutral check and failing sync semantics for absent installations', () => {
    const common = [
      '--repo-root',
      repo,
      '--cache-path',
      cache,
      '--absent-check',
      'neutral',
      '--json',
    ];
    const check = invoke('cache', 'check', ...common);
    assert.equal(check.status, 0);
    assert.equal(JSON.parse(check.stdout).status, 'not_installed');
    const sync = invoke('cache', 'sync', ...common);
    assert.equal(sync.status, 1);
    assert.equal(JSON.parse(sync.stdout).status, 'not_installed');
  });
  it('keeps JSON undecorated and debug on stderr through a raw sync/check flow', async () => {
    const common = [
      '--repo-root',
      repo,
      '--cache-path',
      cache,
      '--missing-target',
      'create',
      '--json',
    ];
    const dryRun = invoke('cache', 'sync', ...common, '--dry-run', '--debug');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).status, 'planned');
    assert.ok(!dryRun.stdout.includes('\x1b'));
    assert.match(dryRun.stderr, /debug:/);
    await assert.rejects(lstat(cache), { code: 'ENOENT' });
    assert.equal(invoke('cache', 'sync', ...common).status, 0);
    const check = invoke('cache', 'check', ...common);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).status, 'synchronized_directory');
    assert.equal(check.stderr, '');
    await writeFile(path.join(cache, 'extra'), 'drift');
    assert.equal(invoke('doctor', ...common).status, 1);
  });
  it('applies CLI over environment and supports explicit boolean negation', () => {
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
  it('reports malformed source metadata without writing the cache', async () => {
    await writeFile(path.join(repo, '.codex-plugin/plugin.json'), '{');
    const result = invoke(
      'cache',
      'sync',
      '--repo-root',
      repo,
      '--cache-path',
      cache,
      '--missing-target',
      'create',
      '--json',
    );
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.equal(JSON.parse(result.stdout).source.valid, false);
    await assert.rejects(lstat(cache), { code: 'ENOENT' });
  });
  it('keeps JSON help color-free even when terminal colors are forced', () => {
    const result = invoke('--help', '--json');
    assert.equal(result.status, 0);
    assert.match(JSON.parse(result.stdout).help, /Usage: codex-tools/);
    assert.ok(!result.stdout.includes('\\u001b'));
  });
  it('offers a wrapper entrypoint without changing process exit state', async () => {
    const stdout = {
      text: '',
      write(value: string) {
        this.text += value;
      },
    };
    const stderr = {
      text: '',
      write(value: string) {
        this.text += value;
      },
    };
    assert.equal(await runCLI(['--version'], { stdout, stderr, env: {} }), 0);
    assert.equal(stdout.text.trim(), packageJson.version);
    assert.equal(stderr.text, '');
  });
  it('keeps environment-selected JSON on argument failure', async () => {
    const stdout = {
      text: '',
      write(value: string) {
        this.text += value;
      },
    };
    const stderr = {
      text: '',
      write(value: string) {
        this.text += value;
      },
    };
    assert.equal(
      await runCLI(['--unknown'], { stdout, stderr, env: { CODEX_TOOLS_JSON: 'true' } }),
      2,
    );
    assert.equal(JSON.parse(stdout.text).status, 'error');
  });
});
