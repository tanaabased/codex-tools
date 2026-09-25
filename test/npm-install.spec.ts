import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { CodexToolsOptions } from '../utils/parse-args.ts';
import { installPlugin } from '../lib/install.ts';
import type { NativeOptions, NativeResult, NativeRunner } from '../lib/codex-native.ts';
import type { NpmRunner } from '../lib/install-types.ts';
import { parseArgs } from '../utils/parse-args.ts';
import { parseNpmSelector, registryUrl } from '../utils/npm-selector.ts';
import { refreshPlugin } from '../lib/refresh.ts';
import { supportedCodexVersion } from '../lib/codex-native.ts';

const json = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
const response = (argv: readonly string[], value: unknown): NativeResult => ({
  argv,
  exitCode: 0,
  stdout: JSON.stringify(value),
  stderr: '',
});

describe('lib/npm-install', () => {
  interface FixtureSource {
    source: string;
    package: string;
    version: string;
  }
  interface FixtureEntry {
    name: string;
    source: FixtureSource;
  }
  interface FixtureCatalog {
    name: string;
    plugins: FixtureEntry[];
  }
  interface InstalledPlugin {
    pluginId: string;
    name: string;
    marketplaceName: string;
    version: string;
    installed: boolean;
    enabled: boolean;
    source: FixtureSource;
  }
  let root = '';
  let home = '';
  let codexHome = '';
  let env: NodeJS.ProcessEnv = {};
  let catalogFile = '';
  let calls: string[][] = [];
  let release: string | string[] = '';
  let pluginVersion = '';
  let pluginName = '';
  let installed: InstalledPlugin | null = null;
  let failure: 'npm' | 'staging' | 'target' | null = null;
  let malformed = false;
  let mutate: (() => Promise<unknown>) | null = null;
  let stalePayload = false;
  const packageName = '@fixture/not-the-plugin-name';
  const npm: NpmRunner = async (argv) => {
    calls.push(['npm', ...argv]);
    if (failure === 'npm')
      return {
        argv,
        exitCode: 1,
        stdout: '',
        stderr: 'E401 https://user:secret@registry.invalid token=npm_supersecret',
      };
    if (argv[0] === '--version') return { argv, exitCode: 0, stdout: '11.19.0', stderr: '' };
    if (argv[0] === 'config')
      return { argv, exitCode: 0, stdout: 'https://registry.npmjs.org/', stderr: '' };
    return response(argv, release);
  };
  const native: NativeRunner = async (argv, options: NativeOptions = {}) => {
    const childEnv = options.env;
    assert.ok(childEnv?.CODEX_HOME);
    assert.ok(childEnv.HOME);
    calls.push(['codex', ...argv]);
    if (argv[0] === '--version')
      return { argv, exitCode: 0, stdout: 'codex-cli ' + supportedCodexVersion, stderr: '' };
    const staging = childEnv.CODEX_HOME !== codexHome;
    const file = staging
      ? path.join(childEnv.HOME, '.agents/plugins/marketplace.json')
      : catalogFile;
    const catalog: FixtureCatalog | null = await readFile(file, 'utf8').then(
      (value) => JSON.parse(value) as FixtureCatalog,
      () => null,
    );
    if (argv[1] === 'marketplace')
      return response(argv, {
        marketplaces: catalog ? [{ name: catalog.name, root: childEnv.HOME }] : [],
      });
    if (argv[1] === 'list')
      return response(argv, { installed: installed ? [installed] : [], available: [] });
    assert.ok(catalog);
    const entry = catalog.plugins.find((row) => row.source.package === packageName);
    assert.ok(entry);
    if (staging && entry.name !== pluginName)
      return {
        argv,
        exitCode: 1,
        stdout: '',
        stderr:
          'plugin.json name `' +
          pluginName +
          '` does not match marketplace plugin name `codex-tools-identity-probe`',
      };
    if (failure === (staging ? 'staging' : 'target'))
      return {
        argv,
        exitCode: 37,
        stdout: 'npm_supersecret',
        stderr: 'E401 token=npm_supersecret',
      };
    const cachePath = path.join(
      childEnv.CODEX_HOME,
      'plugins/cache',
      catalog.name,
      entry.name,
      pluginVersion,
    );
    if (!(stalePayload && !staging)) {
      await json(path.join(cachePath, '.codex-plugin/plugin.json'), {
        name: pluginName,
        version: pluginVersion,
        ...(malformed ? { skills: './missing' } : {}),
        futureOptionalField: true,
      });
      await json(path.join(cachePath, 'package.json'), {
        name: packageName,
        version: entry.source.version,
      });
    }
    if (staging && mutate) await mutate();
    if (!staging)
      installed = {
        pluginId: entry.name + '@' + catalog.name,
        name: entry.name,
        marketplaceName: catalog.name,
        version: pluginVersion,
        installed: true,
        enabled: true,
        source: entry.source,
      };
    return response(argv, {
      name: entry.name,
      pluginId: entry.name + '@' + catalog.name,
      marketplaceName: catalog.name,
      version: pluginVersion,
      installedPath: cachePath,
    });
  };
  const run = (selector = 'npm:' + packageName + '@1.2.3', extra: CodexToolsOptions = {}) =>
    installPlugin({ npmSelector: selector, ...extra }, { env, native, npm });
  const refresh = (selector = 'npm:' + packageName, extra: CodexToolsOptions = {}) =>
    refreshPlugin({ npmSelector: selector, ...extra }, { env, native, npm });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'npm-install-test-')));
    home = path.join(root, 'home');
    codexHome = path.join(root, 'codex');
    await mkdir(home);
    await mkdir(codexHome);
    catalogFile = path.join(home, '.agents/plugins/marketplace.json');
    env = { HOME: home, CODEX_HOME: codexHome, PATH: process.env.PATH };
    calls = [];
    release = '1.2.3';
    pluginVersion = '7.0.0';
    pluginName = 'actual-plugin';
    installed = null;
    failure = null;
    malformed = false;
    mutate = null;
    stalePayload = false;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should accept npm selectors without changing local parsing or trusting acquisition URLs', () => {
    for (const input of [
      'npm:plain',
      'npm:plain@latest',
      'npm:@scope/package@1.2.3',
      'npm:@scope/package@^1.0.0',
      'npm:plain@>=1 <2',
      'npm:plain@1.2.x',
    ])
      assert.equal(parseArgs(['install', input], {}).npmSelector, input);
    for (const input of [
      'npm:',
      'npm:@scope',
      'npm:../file',
      'npm:plain@',
      'npm:plain@https://example.com/file',
      'npm:plain@file:./foo',
      'npm:plain@npm:other',
      'npm:plain@@latest',
      'npm:plain@1..2',
    ])
      assert.throws(() => parseNpmSelector(input), /Invalid npm selector/);
    assert.equal(parseArgs(['install', './npm:local'], {}).repoRoot, './npm:local');
    assert.equal(
      parseArgs(['install', 'npm:plain'], { CODEX_TOOLS_REPO_ROOT: '/old' }).repoRoot,
      undefined,
    );
    for (const url of [
      'http://example.com',
      'https://user:password@example.com',
      'https://example.com/?token=secret',
    ])
      assert.throws(() => registryUrl(url), /HTTPS URL/);
  });
  it('should keep npm dry-run free of all subprocesses and writes, with unresolved values pending', async () => {
    const result = await run(undefined, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.source.name, null);
    assert.deepEqual(calls, []);
    await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  });
  it('should retain a linked catalog across npm install and refresh', async () => {
    await json(catalogFile, { name: 'personal', plugins: [] });
    const target = path.join(root, 'linked-catalog.json');
    await rename(catalogFile, target);
    await symlink(target, catalogFile);
    const before = await lstat(catalogFile);
    const physicalHome = path.join(root, 'codex-target');
    await rename(codexHome, physicalHome);
    await symlink(physicalHome, codexHome);
    const homeBefore = await lstat(codexHome);
    const first = await installPlugin({ npmSelector: 'npm:' + packageName }, { env, native, npm });
    assert.equal(first.ok, true, first.issue ?? undefined);
    const refreshed = await refreshPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native, npm },
    );
    assert.equal(refreshed.ok, true, refreshed.issue ?? undefined);
    assert.equal((await lstat(catalogFile)).ino, before.ino);
    assert.equal((await lstat(codexHome)).ino, homeBefore.ino);
    assert.equal((await lstat(catalogFile)).isSymbolicLink(), true);
  });
  it('should read identity from the acquired manifest and persist an exact native npm entry', async () => {
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(result.source.name, 'actual-plugin');
    assert.equal(result.source.version, '1.2.3');
    assert.equal(result.inspection.payload, 'verified');
    assert.equal(result.mapping, null);
    const entry = JSON.parse(await readFile(catalogFile, 'utf8')).plugins[0];
    assert.equal(entry.source.source, 'npm');
    assert.equal(entry.source.version, '1.2.3');
    assert.equal(entry.codexTools.npm.pluginVersion, '7.0.0');
    await assert.rejects(lstat(path.join(home, 'plugins')), { code: 'ENOENT' });
  });
  it('should resolve a tag or range, leave repeats untouched, and refresh the pin after the tag moves', async () => {
    release = ['1.2.2', '1.2.3'];
    assert.equal((await run('npm:' + packageName + '@^1.2.0')).ok, true);
    const before = await lstat(catalogFile);
    calls = [];
    assert.equal((await run('npm:' + packageName + '@^1.2.0')).ok, true);
    assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
    assert.equal(calls.filter((row) => row[0] === 'codex' && row[2] === 'add').length, 2);
    release = '2.0.0';
    calls = [];
    const result = await refresh();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(result.status, 'refreshed');
    assert.equal(result.source.version, '1.2.3');
    assert.ok(!calls.some((row) => row[0] === 'npm' && row[1] === 'view'));
    assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
    await assert.rejects(refresh('npm:' + packageName + '@latest'), /cannot select another/);
  });
  it('should allow explicit release changes and detect stale native payload even with an unchanged plugin version', async () => {
    assert.equal((await run()).ok, true);
    release = '2.0.0';
    stalePayload = true;
    const failed = await run('npm:' + packageName + '@2.0.0');
    assert.equal(failed.ok, false);
    assert.match(failed.issue ?? '', /payload does not match/);
    stalePayload = false;
    // retry must repair a stale payload, not skip it based on catalog metadata.
    const retry = await run('npm:' + packageName + '@2.0.0');
    assert.equal(retry.ok, true, retry.issue ?? undefined);
  });
  for (const kind of ['local collision', 'package collision', 'incomplete', 'concurrent']) {
    it('should preserve unrelated catalog entries on ' + kind, async () => {
      const other = {
        name: 'unrelated',
        source: { source: 'npm', package: 'other', version: '1.0.0' },
        custom: true,
      };
      const plugins: unknown[] = [other];
      if (kind.includes('collision'))
        plugins.push({
          name: 'actual-plugin',
          source:
            kind === 'local collision'
              ? { source: 'local', path: './different' }
              : { source: 'npm', package: 'different', version: '1.0.0' },
        });
      await json(catalogFile, { name: 'personal', plugins });
      const before = await readFile(catalogFile, 'utf8');
      if (kind === 'incomplete') malformed = true;
      if (kind === 'concurrent') mutate = () => writeFile(catalogFile, before + '\n');
      const result = await run();
      assert.equal(result.ok, false);
      assert.equal(
        await readFile(catalogFile, 'utf8'),
        before + (kind === 'concurrent' ? '\n' : ''),
      );
      assert.equal(installed, null);
    });
  }
  for (const phase of ['npm', 'staging', 'target'] as const) {
    it('should redact registry credentials and report failure effects at ' + phase, async () => {
      failure = phase;
      const result = await run();
      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes('supersecret'));
      assert.ok(!JSON.stringify(result).includes('user:secret'));
      assert.match(result.issue ?? '', /authentication/);
      if (phase === 'target')
        assert.ok(result.completed.some((step) => step.operation === 'write-catalog'));
      else await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
    });
  }
  it('should preserve disabled installations and refuse refresh that would enable one', async () => {
    assert.equal((await run()).ok, true);
    assert.ok(installed);
    installed.enabled = false;
    assert.equal((await run()).status, 'installed_pending_enablement');
    const result = await refresh();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Enable/);
    assert.ok(installed);
    assert.equal(installed.enabled, false);
  });
  it('should reject a package whose npm metadata does not match its acquired release', async () => {
    const wrong: NativeRunner = async (argv, opts) => {
      const child = await native(argv, opts);
      if (argv[1] === 'add' && child.exitCode === 0 && opts?.env?.CODEX_HOME !== codexHome) {
        const dir = JSON.parse(child.stdout).installedPath;
        await json(path.join(dir, 'package.json'), { name: packageName, version: '9.0.0' });
      }
      return child;
    };
    const result = await installPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native: wrong, npm },
    );
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /does not match/);
    assert.equal(installed, null);
  });
  it('should detect unrelated configuration changes made during native installation', async () => {
    const configFile = path.join(codexHome, 'config.toml');
    await writeFile(configFile, 'model = "preserve-me"\n');
    const changed: NativeRunner = async (argv, opts) => {
      const child = await native(argv, opts);
      if (argv[1] === 'add' && opts?.env?.CODEX_HOME === codexHome)
        await writeFile(configFile, 'model = "unexpected"\n');
      return child;
    };
    const result = await installPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native: changed, npm },
    );
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Unrelated Codex configuration/);
    assert.ok(result.nativeState);
  });
  it('should retain the pinned registry even after scoped npm configuration changes', async () => {
    assert.equal((await run()).ok, true);
    env['npm_config_@fixture:registry'] = 'https://another-registry.invalid';
    const checked: NativeRunner = async (argv, opts) => {
      if (argv[1] === 'add') {
        assert.ok(opts?.env);
        assert.equal(opts.env['npm_config_@fixture:registry'], 'https://registry.npmjs.org');
      }
      return native(argv, opts);
    };
    const result = await refreshPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native: checked, npm },
    );
    assert.equal(result.ok, true, result.issue ?? undefined);
  });
  it('should not expose credentials from malformed npm registry configuration', async () => {
    const badRegistry: NpmRunner = async (argv) =>
      argv[0] === 'config'
        ? { argv, exitCode: 0, stdout: 'https://user:supersecret@example.com', stderr: '' }
        : npm(argv);
    const result = await installPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native, npm: badRegistry },
    );
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('supersecret'));
    assert.match(result.issue ?? '', /HTTPS URL/);
    await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  });
});
