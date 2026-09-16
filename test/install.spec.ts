import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeRunner } from '../lib/codex-native.ts';
import type {
  MarketplaceEntry,
  MarketplacePolicy,
  MarketplaceSource,
} from '../lib/install-context.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';
import { installPlugin } from '../lib/install.ts';
import { parseArgs } from '../utils/parse-args.ts';
import { asError, hasErrorCode } from '../utils/errors.ts';

const cli = fileURLToPath(new URL('../bin/codex-tools.ts', import.meta.url));
const writeJson = async (file: string, data: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
};
interface FixtureEntry extends MarketplaceEntry {
  name: string;
  source: MarketplaceSource;
  policy: MarketplacePolicy;
  category: string;
  interface?: { displayName: string };
}

interface InstalledPlugin {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  source: { source: string; path: string };
  authPolicy: string;
}

const entry = (name = 'sample', source = './plugins/sample'): FixtureEntry => ({
  name,
  source: { source: 'local', path: source },
  policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
  category: 'Custom',
});

describe('local installation (Me link-preservation and catalog reconciliation)', () => {
  let root = '';
  let home = '';
  let codexHome = '';
  let repoRoot = '';
  let catalogFile = '';
  let mapping = '';
  let env: NodeJS.ProcessEnv = {};
  let options: CodexToolsOptions = {};
  let calls: Array<readonly string[]> = [];
  let installed: InstalledPlugin | null = null;
  let marketRoot = '';
  let market = '';
  let failure: ((argv: readonly string[]) => boolean) | null = null;
  let hook: ((argv: readonly string[]) => Promise<void>) | null = null;
  const native: NativeRunner = async (argv) => {
    calls.push(argv);
    if (hook) await hook(argv);
    if (failure?.(argv))
      return { argv, exitCode: 37, stdout: 'child output', stderr: 'native failure' };
    let data;
    if (argv[0] === '--version')
      return { argv, exitCode: 0, stdout: 'codex-cli 0.153.4\n', stderr: '' };
    if (argv[1] === 'marketplace' && argv[2] === 'list') {
      const exists = await readFile(catalogFile, 'utf8').then(
        () => true,
        (error: unknown) => {
          if (hasErrorCode(error, 'ENOENT')) return false;
          throw error;
        },
      );
      data = { marketplaces: exists ? [{ name: market, root: marketRoot }] : [] };
    } else if (argv[1] === 'marketplace' && argv[2] === 'add') {
      await writeFile(
        path.join(codexHome, 'config.toml'),
        '[marketplaces.' +
          market +
          ']\nsource_type = "local"\nsource = ' +
          JSON.stringify(marketRoot) +
          '\n',
      );
      data = { marketplaceName: market, installedRoot: marketRoot };
    } else if (argv[1] === 'add') {
      installed = {
        pluginId: 'sample@' + market,
        name: 'sample',
        marketplaceName: market,
        version: '1.0.0',
        installed: true,
        enabled: true,
        source: { source: 'local', path: mapping },
        authPolicy: 'ON_INSTALL',
      };
      data = { pluginId: installed.pluginId };
    } else data = { installed: installed ? [installed] : [], available: [] };
    return { argv, exitCode: 0, stdout: JSON.stringify(data), stderr: '' };
  };
  const run = (extra: CodexToolsOptions = {}) =>
    installPlugin({ ...options, ...extra }, { env, native });
  const catalog = (plugins: unknown[] = [], extra: Record<string, unknown> = {}) =>
    writeJson(catalogFile, { name: market, plugins, ...extra });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-install-test-')));
    home = path.join(root, 'home');
    codexHome = path.join(root, 'codex');
    repoRoot = path.join(root, "external source ' $(not-a-command)");
    await mkdir(home);
    await mkdir(codexHome);
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), {
      name: 'sample',
      version: '1.0.0',
    });
    catalogFile = path.join(home, '.agents/plugins/marketplace.json');
    mapping = path.join(home, 'plugins/sample');
    env = { HOME: home, CODEX_HOME: codexHome, PATH: process.env.PATH };
    options = { repoRoot, codexHome };
    calls = [];
    installed = null;
    marketRoot = home;
    market = 'personal';
    failure = null;
    hook = null;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('installs a standalone plugin without package.json and skips native add on repetition', async () => {
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(result.inspection.installed, true);
    assert.equal(result.inspection.authentication, 'unknown');
    assert.equal(result.inspection.activation, 'unknown');
    assert.equal(await realpath(mapping), repoRoot);
    assert.deepEqual(
      calls.find((argv) => argv[1] === 'add'),
      ['plugin', 'add', '--json', '--', 'sample@personal'],
    );
    assert.ok(!calls.some((argv) => argv[1] === 'marketplace' && argv[2] === 'add'));
    const before = await lstat(catalogFile),
      linkBefore = await lstat(mapping);
    calls = [];
    assert.equal((await run()).ok, true);
    assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
    assert.equal((await lstat(mapping)).ino, linkBefore.ino);
    assert.ok(!calls.some((argv) => argv[1] === 'add'));
  });
  it('accepts native defaults without rewriting an existing entry', async () => {
    await writeJson(catalogFile, { name: market });
    assert.equal((await run()).ok, true);
    const minimal = { name: 'sample', source: { source: 'local', path: './plugins/sample' } };
    await catalog([minimal]);
    const before = await readFile(catalogFile, 'utf8');
    assert.equal((await run()).ok, true);
    assert.equal(await readFile(catalogFile, 'utf8'), before);
  });
  it('lists fresh Codex home creation in dry run and performs it before discovery', async () => {
    await rm(codexHome, { recursive: true });
    const preview = await run({ dryRun: true });
    assert.ok(preview.plan.some((step) => step.operation === 'create-codex-home'));
    await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
    hook = async (argv) => {
      if (argv[1] === 'marketplace') assert.equal((await lstat(codexHome)).isDirectory(), true);
    };
    assert.equal((await run()).ok, true);
  });
  it('stops on a changed source mapping without replacing it', async () => {
    hook = async (argv) => {
      if (argv[0] === '--version') {
        await mkdir(path.dirname(mapping), { recursive: true });
        await writeFile(mapping, 'concurrent file');
      }
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /mapping changed/);
    assert.equal(await readFile(mapping, 'utf8'), 'concurrent file');
  });
  it('does not overwrite or reinstall a different installed version', async () => {
    assert.equal((await run()).ok, true);
    assert.ok(installed);
    installed.version = '0.9.0';
    calls = [];
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Another version/);
    assert.ok(!calls.some((argv) => argv[1] === 'add'));
  });
  it('rejects an unsupported native version before setup', async () => {
    const result = await installPlugin(options, {
      env,
      native: async (argv) => ({ argv, exitCode: 0, stdout: 'codex-cli 0.154.0', stderr: '' }),
    });
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Supported native contract/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('reports malformed native JSON and incompatible readback without claiming success', async () => {
    const result = await installPlugin(options, {
      env,
      native: async (argv) =>
        argv[0] === '--version' ? native(argv) : { argv, exitCode: 0, stdout: '{', stderr: '' },
    });
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /invalid JSON/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('makes dry run entirely read-only, including no native process', async () => {
    const result = await run({ dryRun: true });
    assert.equal(result.status, 'planned');
    assert.equal(result.ok, true);
    assert.deepEqual(calls, []);
    assert.ok(result.plan.some((step) => step.operation === 'map-source'));
    assert.ok(result.plan.some((step) => step.operation === 'write-catalog'));
    assert.ok(result.plan.some((step) => step.operation === 'install'));
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  });
  it('preserves metadata, policy, ordering, regular files, and unrelated links', async () => {
    await catalog([entry('other', './elsewhere')], {
      interface: { displayName: 'Keep this' },
      custom: { order: 7 },
    });
    await mkdir(path.dirname(mapping), { recursive: true });
    await writeFile(path.join(home, 'plugins/notes'), 'keep');
    await symlink('../missing', path.join(home, 'plugins/unrelated'));
    assert.equal((await run()).ok, true);
    const data = JSON.parse(await readFile(catalogFile, 'utf8'));
    assert.deepEqual(data.plugins[0], entry('other', './elsewhere'));
    assert.equal(data.plugins[1].name, 'sample');
    assert.deepEqual(data.interface, { displayName: 'Keep this' });
    assert.deepEqual(data.custom, { order: 7 });
    assert.equal(await readFile(path.join(home, 'plugins/notes'), 'utf8'), 'keep');
    assert.equal((await lstat(path.join(home, 'plugins/unrelated'))).isSymbolicLink(), true);
  });
  it('leaves an existing matching catalog byte-for-byte intact, including ON_USE policy', async () => {
    const value = entry();
    value.policy.authentication = 'ON_USE';
    value.interface = { displayName: 'Special' };
    await catalog([value]);
    await mkdir(path.dirname(mapping), { recursive: true });
    await symlink(repoRoot, mapping);
    const before = await readFile(catalogFile, 'utf8');
    assert.equal((await run()).ok, true);
    assert.equal(await readFile(catalogFile, 'utf8'), before);
  });
  it('reuses an existing in-root source without requiring a symlink', async () => {
    repoRoot = path.join(home, 'existing');
    options.repoRoot = repoRoot;
    mapping = repoRoot;
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), {
      name: 'sample',
      version: '1.0.0',
    });
    await catalog([entry('sample', './existing')]);
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.ok(!result.plan.some((step) => step.operation === 'map-source'));
  });
  it('generates a catalog and registers an explicitly selected local marketplace', async () => {
    marketRoot = path.join(root, 'market space');
    await mkdir(marketRoot);
    market = 'selected';
    catalogFile = path.join(marketRoot, '.agents/plugins/marketplace.json');
    mapping = path.join(marketRoot, 'plugins/sample');
    const selected = { marketplacePath: catalogFile, marketplace: market };
    const preview = await run({ ...selected, dryRun: true });
    assert.ok(preview.plan.some((step) => step.operation === 'register-marketplace'));
    assert.equal((await run(selected)).ok, true);
    calls = [];
    assert.equal((await run({ marketplace: market })).ok, true);
    assert.ok(!calls.some((argv) => argv[1] === 'marketplace' && argv[2] === 'add'));
  });
  for (const kind of ['file', 'directory', 'unrelated link', 'dangling link']) {
    it('refuses to replace a ' + kind + ' at the source mapping', async () => {
      await mkdir(path.dirname(mapping), { recursive: true });
      if (kind === 'file') await writeFile(mapping, 'preserve');
      else if (kind === 'directory') await mkdir(mapping);
      else await symlink(kind === 'dangling link' ? path.join(root, 'missing') : home, mapping);
      const before = await lstat(mapping);
      await assert.rejects(run(), /Refusing to replace/);
      assert.equal((await lstat(mapping)).ino, before.ino);
      assert.deepEqual(calls, []);
    });
  }
  for (const bad of [
    null,
    [],
    {},
    { name: 'bad@name', plugins: [] },
    { name: 'personal', plugins: {} },
    { name: 'personal', plugins: [entry(), entry()] },
    { name: 'personal', plugins: [entry('sample', '../escape')] },
    { name: 'personal', interface: 'bad', plugins: [] },
  ]) {
    it('refuses malformed catalogs without effects: ' + JSON.stringify(bad), async () => {
      await writeJson(catalogFile, bad);
      const before = await readFile(catalogFile, 'utf8');
      await assert.rejects(run());
      assert.equal(await readFile(catalogFile, 'utf8'), before);
      assert.deepEqual(calls, []);
      await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    });
  }
  it('rejects malformed JSON, blocked policy, duplicate source, and nonlocal name collisions', async () => {
    await catalog();
    await writeFile(catalogFile, '{');
    await assert.rejects(run(), SyntaxError);
    const blocked = entry();
    blocked.policy.installation = 'NOT_AVAILABLE';
    await catalog([blocked]);
    await assert.rejects(run(), /policy/);
    await mkdir(path.join(home, 'plugins'), { recursive: true });
    await symlink(repoRoot, path.join(home, 'plugins/other'));
    await catalog([entry('other', './plugins/other')]);
    await assert.rejects(run(), /another plugin name/);
    const remote = entry();
    remote.source = { source: 'npm', package: 'sample' };
    await catalog([remote]);
    await assert.rejects(run(), /collision/);
  });
  it('detects a catalog source collision even when its mapping is missing', async () => {
    await catalog([entry('other', './plugins/sample')]);
    await assert.rejects(run(), /another plugin name/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    assert.deepEqual(calls, []);
  });
  it('rejects unsafe or malformed source prerequisites before effects', async () => {
    for (const value of [
      null,
      { name: '../escape' },
      { name: 'sample', version: '../../escape' },
      { name: 'sample', skills: './missing' },
    ]) {
      await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), value);
      await assert.rejects(run(), (error) => asError(error).source?.valid === false);
    }
    await symlink(home, path.join(repoRoot, 'skills'));
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), {
      name: 'sample',
      skills: './skills',
    });
    await assert.rejects(run(), /escapes/);
    assert.deepEqual(calls, []);
  });
  it('refuses a marketplace-name collision in selected Codex configuration', async () => {
    await writeFile(
      path.join(codexHome, 'config.toml'),
      '[marketplaces.personal]\nsource_type = "git"\nsource = "https://example.invalid/repo"\n',
    );
    await assert.rejects(run(), /collision/);
    assert.deepEqual(calls, []);
  });
  it('refuses linked catalog parents without altering their targets', async () => {
    await symlink(root, path.join(home, '.agents'));
    await assert.rejects(run(), /real directory/);
    assert.deepEqual(calls, []);
  });
  for (const phase of ['preflight', 'register', 'install', 'readback']) {
    it(
      'reports completed work, remaining operations, and child errors after ' + phase + ' failure',
      async () => {
        if (phase === 'register') {
          marketRoot = path.join(root, 'selected');
          await mkdir(marketRoot);
          market = 'selected';
          catalogFile = path.join(marketRoot, '.agents/plugins/marketplace.json');
          mapping = path.join(marketRoot, 'plugins/sample');
          options.marketplacePath = catalogFile;
          options.marketplace = market;
        }
        failure = (argv) =>
          phase === 'preflight'
            ? argv[0] === '--version'
            : phase === 'register'
              ? argv[2] === 'add'
              : phase === 'install'
                ? argv[1] === 'add'
                : argv[1] === 'list' && installed !== null;
        const result = await run();
        assert.equal(result.ok, false);
        assert.equal(result.exitCode, 37);
        assert.ok(result.nativeError);
        assert.equal(result.nativeError.stdout, 'child output');
        assert.equal(result.nativeError.stderr, 'native failure');
        assert.ok(result.remaining[0]);
        assert.equal(
          result.remaining[0].operation,
          phase === 'register' ? 'register-marketplace' : phase,
        );
        if (phase !== 'preflight') {
          assert.ok(result.completed.some((step) => step.operation === 'write-catalog'));
          assert.equal(await realpath(mapping), repoRoot);
        }
      },
    );
  }
  it('detects intervening catalog edits before any filesystem changes', async () => {
    await catalog();
    hook = async (argv) => {
      if (argv[0] === '--version') await catalog([], { note: 'concurrent' });
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /changed/);
    assert.equal(JSON.parse(await readFile(catalogFile, 'utf8')).note, 'concurrent');
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('does not infer installation from an empty successful native response', async () => {
    hook = async (argv) => {
      if (argv[1] === 'list') installed = null;
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /not observed/);
    assert.ok(result.remaining[0]);
    assert.equal(result.remaining[0].operation, 'readback');
  });
  it('keeps a disabled installation disabled on repeated install', async () => {
    assert.equal((await run()).ok, true);
    assert.ok(installed);
    installed.enabled = false;
    const result = await run();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'installed_pending_enablement');
  });
  it('uses strict positional/option/environment precedence', () => {
    assert.equal(
      parseArgs(['install', '/positional'], { CODEX_TOOLS_REPO_ROOT: '/env' }).repoRoot,
      '/positional',
    );
    assert.throws(() => parseArgs(['install', '/one', '/two'], {}));
    assert.throws(() => parseArgs(['install', '/one', '--repo-root', '/two'], {}));
    assert.throws(() => parseArgs(['status', '--marketplace-path', catalogFile], {}));
  });
  it('executes a fake Codex through argv and preserves the actual child exit code in CLI JSON', async () => {
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nprintf native-failure >&2\nexit 37\n', {
      mode: 0o755,
    });
    const result = spawnSync(process.execPath, [cli, 'install', repoRoot, '--json'], {
      cwd: home,
      env: { ...env, PATH: bin + path.delimiter + env.PATH },
      encoding: 'utf8',
    });
    assert.equal(result.status, 37, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.nativeError.exitCode, 37);
    assert.equal(data.status, 'incomplete');
    assert.ok(!result.stdout.includes('\x1b'));
  });
});
