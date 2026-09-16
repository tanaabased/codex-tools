import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installPlugin } from '../lib/install.js';
import { refreshPlugin } from '../lib/refresh.js';
import { parseArgs } from '../utils/parse-args.js';
import { parseNpmSelector, registryUrl } from '../utils/npm-selector.js';

const json = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
const response = (argv, value) => ({
  argv,
  exitCode: 0,
  stdout: JSON.stringify(value),
  stderr: '',
});

describe('npm installation through native acquisition and shared marketplace orchestration', () => {
  let root,
    home,
    codexHome,
    env,
    catalogFile,
    calls,
    release,
    pluginVersion,
    pluginName,
    installed,
    failure,
    malformed,
    mutate,
    stalePayload;
  const packageName = '@fixture/not-the-plugin-name';
  async function npm(argv) {
    calls.push(['npm', ...argv]);
    if (failure === 'npm')
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'E401 https://user:secret@registry.invalid token=npm_supersecret',
      };
    if (argv[0] === '--version') return { exitCode: 0, stdout: '11.19.0', stderr: '' };
    if (argv[0] === 'config')
      return { exitCode: 0, stdout: 'https://registry.npmjs.org/', stderr: '' };
    return response(argv, release);
  }
  async function native(argv, { env: childEnv }) {
    calls.push(['codex', ...argv]);
    if (argv[0] === '--version') return { exitCode: 0, stdout: 'codex-cli 0.153.4', stderr: '' };
    const staging = childEnv.CODEX_HOME !== codexHome;
    const file = staging
      ? path.join(childEnv.HOME, '.agents/plugins/marketplace.json')
      : catalogFile;
    const catalog = await readFile(file, 'utf8').then(JSON.parse, () => null);
    if (argv[1] === 'marketplace')
      return response(argv, {
        marketplaces: catalog ? [{ name: catalog.name, root: childEnv.HOME }] : [],
      });
    if (argv[1] === 'list')
      return response(argv, { installed: installed ? [installed] : [], available: [] });
    const entry = catalog.plugins.find((row) => row.source?.package === packageName);
    if (staging && entry.name !== pluginName)
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          'plugin.json name `' +
          pluginName +
          '` does not match marketplace plugin name `codex-tools-identity-probe`',
      };
    if (failure === (staging ? 'staging' : 'target'))
      return { exitCode: 37, stdout: 'npm_supersecret', stderr: 'E401 token=npm_supersecret' };
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
  }
  const run = (selector = 'npm:' + packageName + '@1.2.3', extra = {}) =>
    installPlugin({ npmSelector: selector, ...extra }, { env, native, npm });
  const refresh = (selector = 'npm:' + packageName, extra = {}) =>
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

  it('accepts npm selectors without changing local parsing or trusting acquisition URLs', () => {
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
  it('keeps npm dry-run free of all subprocesses and writes, with unresolved values pending', async () => {
    const result = await run(undefined, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.source.name, null);
    assert.deepEqual(calls, []);
    await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  });
  it('reads identity from the acquired manifest and persists an exact native npm entry', async () => {
    const result = await run();
    assert.equal(result.ok, true, result.issue);
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
  it('resolves a tag or range, leaves repeats untouched, and refreshes the pin after the tag moves', async () => {
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
    assert.equal(result.ok, true, result.issue);
    assert.equal(result.status, 'refreshed');
    assert.equal(result.source.version, '1.2.3');
    assert.ok(!calls.some((row) => row[0] === 'npm' && row[1] === 'view'));
    assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
    await assert.rejects(refresh('npm:' + packageName + '@latest'), /cannot select another/);
  });
  it('allows explicit release changes and detects stale native payload even with an unchanged plugin version', async () => {
    assert.equal((await run()).ok, true);
    release = '2.0.0';
    stalePayload = true;
    const failed = await run('npm:' + packageName + '@2.0.0');
    assert.equal(failed.ok, false);
    assert.match(failed.issue, /payload does not match/);
    stalePayload = false;
    // Retry must repair a stale payload, not skip it based on catalog metadata.
    const retry = await run('npm:' + packageName + '@2.0.0');
    assert.equal(retry.ok, true, retry.issue);
  });
  for (const kind of ['local collision', 'package collision', 'incomplete', 'concurrent']) {
    it('preserves unrelated catalog entries on ' + kind, async () => {
      const other = {
        name: 'unrelated',
        source: { source: 'npm', package: 'other', version: '1.0.0' },
        custom: true,
      };
      const plugins = [other];
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
  for (const phase of ['npm', 'staging', 'target']) {
    it('redacts registry credentials and reports failure effects at ' + phase, async () => {
      failure = phase;
      const result = await run();
      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes('supersecret'));
      assert.ok(!JSON.stringify(result).includes('user:secret'));
      assert.match(result.issue, /authentication/);
      if (phase === 'target')
        assert.ok(result.completed.some((step) => step.operation === 'write-catalog'));
      else await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
    });
  }
  it('preserves disabled installs and refuses refresh that would enable one', async () => {
    assert.equal((await run()).ok, true);
    installed.enabled = false;
    assert.equal((await run()).status, 'installed_pending_enablement');
    const result = await refresh();
    assert.equal(result.ok, false);
    assert.match(result.issue, /Enable/);
    assert.equal(installed.enabled, false);
  });
  it('rejects a package whose npm metadata does not match its acquired release', async () => {
    const wrong = async (argv, opts) => {
      const child = await native(argv, opts);
      if (argv[1] === 'add' && child.exitCode === 0 && opts.env.CODEX_HOME !== codexHome) {
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
    assert.match(result.issue, /does not match/);
    assert.equal(installed, null);
  });
  it('detects unrelated configuration changes made during native installation', async () => {
    const configFile = path.join(codexHome, 'config.toml');
    await writeFile(configFile, 'model = "preserve-me"\n');
    const changed = async (argv, opts) => {
      const child = await native(argv, opts);
      if (argv[1] === 'add' && opts.env.CODEX_HOME === codexHome)
        await writeFile(configFile, 'model = "unexpected"\n');
      return child;
    };
    const result = await installPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native: changed, npm },
    );
    assert.equal(result.ok, false);
    assert.match(result.issue, /Unrelated Codex configuration/);
    assert.ok(result.nativeState);
  });
  it('retains the pinned registry even after scoped npm configuration changes', async () => {
    assert.equal((await run()).ok, true);
    env['npm_config_@fixture:registry'] = 'https://another-registry.invalid';
    const checked = async (argv, opts) => {
      if (argv[1] === 'add')
        assert.equal(opts.env['npm_config_@fixture:registry'], 'https://registry.npmjs.org');
      return native(argv, opts);
    };
    const result = await refreshPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native: checked, npm },
    );
    assert.equal(result.ok, true, result.issue);
  });
  it('does not expose credentials from malformed npm registry configuration', async () => {
    const badRegistry = async (argv) =>
      argv[0] === 'config'
        ? { exitCode: 0, stdout: 'https://user:supersecret@example.com', stderr: '' }
        : npm(argv);
    const result = await installPlugin(
      { npmSelector: 'npm:' + packageName },
      { env, native, npm: badRegistry },
    );
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('supersecret'));
    assert.match(result.issue, /HTTPS URL/);
    await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  });
});
