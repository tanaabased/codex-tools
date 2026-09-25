import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { asError, hasErrorCode } from '../utils/errors.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';
import { installPlugin } from '../lib/install.ts';
import type {
  MarketplaceEntry,
  MarketplacePolicy,
  MarketplaceSource,
} from '../lib/install-context.ts';
import type { NativeRunner } from '../lib/codex-native.ts';
import { parseArgs } from '../utils/parse-args.ts';
import { supportedCodexVersion } from '../lib/codex-native.ts';

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

describe('lib/install', () => {
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
      return { argv, exitCode: 0, stdout: 'codex-cli ' + supportedCodexVersion + '\n', stderr: '' };
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

  it('should install a standalone plugin without package.json and skip native add on repetition', async () => {
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
  it('should accept native defaults without rewriting an existing entry', async () => {
    await writeJson(catalogFile, { name: market });
    assert.equal((await run()).ok, true);
    const minimal = { name: 'sample', source: { source: 'local', path: './plugins/sample' } };
    await catalog([minimal]);
    const before = await readFile(catalogFile, 'utf8');
    assert.equal((await run()).ok, true);
    assert.equal(await readFile(catalogFile, 'utf8'), before);
  });
  it('should list fresh Codex home creation in dry run and perform it before discovery', async () => {
    await rm(codexHome, { recursive: true });
    const preview = await run({ dryRun: true });
    assert.ok(preview.plan.some((step) => step.operation === 'create-codex-home'));
    await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
    hook = async (argv) => {
      if (argv[1] === 'marketplace') assert.equal((await lstat(codexHome)).isDirectory(), true);
    };
    assert.equal((await run()).ok, true);
  });
  it('should stop on a changed source mapping without replacing it', async () => {
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
  it('should not overwrite or reinstall a different installed version', async () => {
    assert.equal((await run()).ok, true);
    assert.ok(installed);
    installed.version = '0.9.0';
    calls = [];
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Another version/);
    assert.ok(!calls.some((argv) => argv[1] === 'add'));
  });
  it('should reject an unsupported native version before setup', async () => {
    const result = await installPlugin(options, {
      env,
      native: async (argv) => ({ argv, exitCode: 0, stdout: 'codex-cli 999.0.0', stderr: '' }),
    });
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /Supported native contract/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('should report malformed native JSON and incompatible readback without claiming success', async () => {
    const result = await installPlugin(options, {
      env,
      native: async (argv) =>
        argv[0] === '--version' ? native(argv) : { argv, exitCode: 0, stdout: '{', stderr: '' },
    });
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /invalid JSON/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('should make dry run entirely read-only, including no native process', async () => {
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
  it('should preserve metadata, policy, ordering, regular files, and unrelated links', async () => {
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
  it('should leave an existing matching catalog byte-for-byte intact, including ON_USE policy', async () => {
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
  it('should reuse an existing in-root source without requiring a symlink', async () => {
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
  it('should generate a catalog and register an explicitly selected local marketplace', async () => {
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
    it('should refuse to replace a ' + kind + ' at the source mapping', async () => {
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
    it('should refuse malformed catalogs without effects: ' + JSON.stringify(bad), async () => {
      await writeJson(catalogFile, bad);
      const before = await readFile(catalogFile, 'utf8');
      await assert.rejects(run());
      assert.equal(await readFile(catalogFile, 'utf8'), before);
      assert.deepEqual(calls, []);
      await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    });
  }
  it('should reject malformed JSON, blocked policy, duplicate source, and nonlocal name collisions', async () => {
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
  it('should reject physically aliased source mappings before creating either catalog entry', async () => {
    await mkdir(path.dirname(mapping), { recursive: true });
    await symlink(path.dirname(mapping), path.join(home, 'alias'));
    await catalog([entry('other', './alias/sample')]);
    const before = await readFile(catalogFile, 'utf8');
    await assert.rejects(run(), /another plugin name/);
    assert.equal(await readFile(catalogFile, 'utf8'), before);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    assert.deepEqual(calls, []);
  });
  it('should reject a mapping that would become an ancestor of selected payload', async () => {
    await mkdir(path.join(repoRoot, 'mappings'));
    await symlink(path.join(repoRoot, 'mappings'), path.dirname(mapping));
    await writeJson(path.join(repoRoot, 'package.json'), {
      codexTools: { managedPaths: ['mappings/sample/future-resource'] },
    });
    await assert.rejects(run(), /source payload/);
    assert.deepEqual(calls, []);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  it('should detect a catalog source collision even when its mapping is missing', async () => {
    await catalog([entry('other', './plugins/sample')]);
    await assert.rejects(run(), /another plugin name/);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    assert.deepEqual(calls, []);
  });
  it('should reject unsafe or malformed source prerequisites before effects', async () => {
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
  it('should refuse a marketplace-name collision in selected Codex configuration', async () => {
    await writeFile(
      path.join(codexHome, 'config.toml'),
      '[marketplaces.personal]\nsource_type = "git"\nsource = "https://example.invalid/repo"\n',
    );
    await assert.rejects(run(), /collision/);
    assert.deepEqual(calls, []);
  });
  it('should accept linked catalog parents without replacing them', async () => {
    await symlink(root, path.join(home, '.agents'));
    const before = await lstat(path.join(home, '.agents'));
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal((await lstat(path.join(home, '.agents'))).ino, before.ino);
  });

  const linkedLayout = async () => {
    const tracked = path.join(root, 'tracked');
    await mkdir(path.join(tracked, 'codex'), { recursive: true });
    await rm(codexHome, { recursive: true });
    await symlink(path.join(tracked, 'codex'), codexHome);
    await mkdir(path.join(tracked, 'agents/plugins'), { recursive: true });
    await symlink(path.join(tracked, 'agents'), path.join(home, '.agents'));
    await mkdir(path.join(tracked, 'mappings'));
    await symlink(path.join(tracked, 'mappings'), path.join(home, 'plugins'));
    const target = path.join(tracked, 'catalog.json');
    await writeJson(target, {
      name: market,
      plugins: [entry('other', './elsewhere')],
      custom: true,
    });
    await chmod(target, 0o640);
    await symlink(target, catalogFile);
    return {
      tracked,
      target,
      links: [codexHome, path.join(home, '.agents'), path.join(home, 'plugins'), catalogFile],
    };
  };
  it('should preserve linked homes, parents, catalog mode, policy, and mappings across dry run and repeat install', async () => {
    const { target, links } = await linkedLayout();
    await symlink(repoRoot, mapping);
    links.push(mapping);
    await symlink('../missing', path.join(home, 'plugins/unrelated'));
    links.push(path.join(home, 'plugins/unrelated'));
    const before = await Promise.all(
      links.map(async (file) => [await readlink(file), (await lstat(file)).ino]),
    );
    const bytes = await readFile(target, 'utf8');
    const preview = await run({ dryRun: true });
    assert.equal(preview.ok, true);
    assert.deepEqual(calls, []);
    assert.equal(await readFile(target, 'utf8'), bytes);
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(result.marketplaceRoot, home);
    assert.equal((await lstat(target)).mode & 0o777, 0o640);
    const data = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(data.plugins[0], entry('other', './elsewhere'));
    assert.equal(data.custom, true);
    const after = await readFile(target, 'utf8');
    calls = [];
    assert.equal((await run()).ok, true);
    assert.ok(!calls.some((argv) => argv[1] === 'add' || argv[2] === 'add'));
    assert.equal(await readFile(target, 'utf8'), after);
    assert.deepEqual(
      await Promise.all(links.map(async (file) => [await readlink(file), (await lstat(file)).ino])),
      before,
    );
  });
  it('should install a catalog-owning repository only with a disjoint managed payload', async () => {
    repoRoot = path.join(root, 'self');
    options.repoRoot = repoRoot;
    const target = path.join(repoRoot, 'dotfiles/catalog.json');
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), {
      name: 'sample',
      version: '1.0.0',
      skills: './skills',
    });
    await mkdir(path.join(repoRoot, 'skills'));
    await writeJson(target, { name: market, plugins: [] });
    await mkdir(path.dirname(catalogFile), { recursive: true });
    await symlink(target, catalogFile);
    await mkdir(path.join(repoRoot, 'dotfiles/mappings'));
    await symlink(path.join(repoRoot, 'dotfiles/mappings'), path.dirname(mapping));
    await assert.rejects(run({ dryRun: true }), /overlaps/);
    await writeJson(path.join(repoRoot, 'package.json'), {
      codexTools: { managedPaths: ['skills', '.codex-plugin'] },
    });
    assert.equal((await run({ dryRun: true })).ok, true);
    assert.deepEqual(calls, []);
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal((await run()).ok, true);
    assert.equal((await lstat(catalogFile)).isSymbolicLink(), true);
    await writeJson(path.join(repoRoot, 'package.json'), {
      codexTools: { managedPaths: ['dotfiles'] },
    });
    await assert.rejects(run(), /overlaps/);
  });
  it('should reject a folded Codex home inside an unmanaged source directory without effects', async () => {
    const state = path.join(repoRoot, 'dotfiles/ai/.codex');
    await mkdir(path.join(state, 'plugins'), { recursive: true });
    await writeJson(path.join(repoRoot, 'package.json'), {
      codexTools: { managedPaths: ['.codex-plugin', 'skills'] },
    });
    await mkdir(path.join(repoRoot, 'skills'));
    await rm(codexHome, { recursive: true });
    codexHome = path.join(home, '.codex');
    options.codexHome = codexHome;
    env.CODEX_HOME = codexHome;
    await symlink(state, codexHome);
    mapping = path.join(codexHome, 'plugins/sample');
    await symlink(repoRoot, mapping);
    const target = path.join(repoRoot, 'dotfiles/ai/.agents/plugins/marketplace.json');
    await writeJson(target, {
      name: market,
      plugins: [entry('sample', './.codex/plugins/sample')],
    });
    await symlink(path.join(repoRoot, 'dotfiles/ai/.agents'), path.join(home, '.agents'));
    const links = [codexHome, mapping, path.join(home, '.agents')];
    const before = await Promise.all(
      links.map(async (file) => [await readlink(file), (await lstat(file)).ino]),
    );
    const bytes = await readFile(target, 'utf8');
    for (const dryRun of [true, false]) {
      await assert.rejects(
        run({ dryRun }),
        /overlaps.*Native Codex does not use codexTools.managedPaths/,
      );
      assert.deepEqual(calls, []);
      assert.equal(await readFile(target, 'utf8'), bytes);
      await assert.rejects(lstat(path.join(state, 'plugins/cache')), { code: 'ENOENT' });
      await assert.rejects(lstat(path.join(state, 'config.toml')), { code: 'ENOENT' });
      assert.deepEqual(
        await Promise.all(
          links.map(async (file) => [await readlink(file), (await lstat(file)).ino]),
        ),
        before,
      );
    }
  });
  for (const kind of ['manifest', 'resource', 'physical-alias', 'installation-state']) {
    it('should retain overlap protection for ' + kind + ' outside managed selection', async () => {
      await writeJson(path.join(repoRoot, 'package.json'), {
        codexTools: { managedPaths: ['.codex-plugin'] },
      });
      let target = path.join(repoRoot, '.codex-plugin/catalog.json');
      if (kind === 'resource') {
        target = path.join(repoRoot, 'skills/catalog.json');
        await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), {
          name: 'sample',
          version: '1.0.0',
          skills: './skills',
        });
      } else if (kind === 'physical-alias') {
        target = path.join(root, 'physical/catalog.json');
        await mkdir(path.dirname(target));
        await symlink(path.dirname(target), path.join(repoRoot, 'payload'));
        await writeJson(path.join(repoRoot, 'package.json'), {
          codexTools: { managedPaths: ['payload'] },
        });
      } else if (kind === 'installation-state') {
        const state = path.join(repoRoot, 'unmanaged-state');
        await mkdir(state);
        await rm(codexHome, { recursive: true });
        await symlink(state, codexHome);
        target = path.join(root, 'catalog.json');
      }
      await writeJson(target, { name: market, plugins: [] });
      await mkdir(path.dirname(catalogFile), { recursive: true });
      await symlink(target, catalogFile);
      const before = await readFile(target, 'utf8');
      await assert.rejects(run(), /overlaps/);
      assert.deepEqual(calls, []);
      assert.equal(await readFile(target, 'utf8'), before);
    });
  }
  it('should resolve parent traversal after intermediate symlinks in a catalog link', async () => {
    const { tracked, target } = await linkedLayout();
    await mkdir(path.join(tracked, 'nested'));
    await symlink(path.join(tracked, 'nested'), path.join(root, 'alias'));
    await rm(catalogFile);
    await symlink(path.join(root, 'alias') + '/../catalog.json', catalogFile);
    assert.equal(await realpath(catalogFile), target);
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(JSON.parse(await readFile(target, 'utf8')).plugins.length, 2);
  });
  it('should retain a configured logical marketplace alias and reject other-name aliases', async () => {
    await catalog();
    const alias = path.join(root, 'market-alias');
    await symlink(home, alias);
    const config = path.join(codexHome, 'config.toml');
    await writeFile(
      config,
      '[marketplaces.personal]\nsource_type = "local"\nsource = ' + JSON.stringify(alias) + '\n',
    );
    const result = await run({ marketplace: 'personal' });
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal(result.marketplaceRoot, alias);
    assert.ok(!result.plan.some((step) => step.operation === 'register-marketplace'));
    await writeFile(
      config,
      '[marketplaces.other]\nsource_type = "local"\nsource = ' + JSON.stringify(alias) + '\n',
    );
    calls = [];
    await assert.rejects(run(), /another name/);
    assert.deepEqual(calls, []);
  });
  for (const kind of ['duplicate-name', 'duplicate-root', 'wrong-root']) {
    it('should reject native ' + kind + ' identities before setup', async () => {
      await catalog();
      const bytes = await readFile(catalogFile, 'utf8');
      const result = await installPlugin(options, {
        env,
        native: async (argv, nativeOptions) => {
          if (argv[1] !== 'marketplace') return native(argv, nativeOptions);
          const row = { name: market, root: home };
          const rows =
            kind === 'duplicate-name'
              ? [row, row]
              : kind === 'duplicate-root'
                ? [row, { name: 'other', root: home }]
                : [{ name: market, root }];
          return { argv, exitCode: 0, stdout: JSON.stringify({ marketplaces: rows }), stderr: '' };
        },
      });
      assert.equal(result.ok, false);
      assert.match(result.issue ?? '', /ambiguous|another name|collision/);
      assert.equal(await readFile(catalogFile, 'utf8'), bytes);
      await assert.rejects(lstat(mapping), { code: 'ENOENT' });
    });
  }
  it('should detect retargeting after setup before native installation', async () => {
    const { target } = await linkedLayout();
    let discoveries = 0;
    hook = async (argv) => {
      if (argv[1] === 'marketplace' && ++discoveries === 2) {
        await rename(catalogFile, catalogFile + '.old');
        await symlink(target, catalogFile);
      }
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /changed/);
    assert.ok(result.completed.some((step) => step.operation === 'write-catalog'));
    assert.ok(!calls.some((argv) => argv[1] === 'add'));
  });
  it('should reject changed payload selection before setup', async () => {
    await writeJson(path.join(repoRoot, 'package.json'), {
      codexTools: { managedPaths: ['.codex-plugin'] },
    });
    hook = async (argv) => {
      if (argv[0] === '--version') await writeJson(path.join(repoRoot, 'package.json'), {});
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /File changed/);
    assert.equal(calls.length, 1);
    await assert.rejects(lstat(mapping), { code: 'ENOENT' });
  });
  for (const changed of [
    'home',
    'parent',
    'catalog',
    'mapping',
    'target-directory',
    'target-file',
    'chain',
    'retarget',
  ]) {
    it('should detect changed ' + changed + ' before dependent effects', async () => {
      const { tracked, target } = await linkedLayout();
      await symlink(repoRoot, mapping);
      const chain = path.join(tracked, 'chain');
      if (changed === 'chain') {
        await symlink(target, chain);
        await rm(catalogFile);
        await symlink(chain, catalogFile);
      }
      const bytes = await readFile(target, 'utf8');
      hook = async (argv) => {
        if (argv[0] !== '--version') return;
        if (changed === 'target-file') {
          await rename(target, target + '.old');
          await writeFile(target, bytes);
        } else if (changed === 'target-directory') {
          await rename(path.join(tracked, 'codex'), path.join(tracked, 'old-codex'));
          await mkdir(path.join(tracked, 'codex'));
        } else {
          const file =
            changed === 'home'
              ? codexHome
              : changed === 'parent'
                ? path.join(home, '.agents')
                : changed === 'mapping'
                  ? mapping
                  : changed === 'chain'
                    ? chain
                    : catalogFile;
          const oldTarget = await readlink(file);
          await rename(file, file + '.old');
          if (changed === 'retarget') await writeFile(target + '.other', bytes);
          await symlink(changed === 'retarget' ? target + '.other' : oldTarget, file);
        }
      };
      const result = await run();
      assert.equal(result.ok, false);
      assert.match(result.issue ?? '', /changed/);
      assert.equal(calls.length, 1);
      assert.equal(await readFile(target, 'utf8'), bytes);
      assert.ok(
        !result.completed.some((step) => ['write-catalog', 'install'].includes(step.operation)),
      );
    });
  }
  for (const location of ['home', 'parent', 'catalog']) {
    for (const kind of ['dangling', 'loop', 'wrong-type']) {
      it('should reject ' + kind + ' ' + location + ' links without effects', async () => {
        const file =
          location === 'home'
            ? codexHome
            : location === 'parent'
              ? path.join(home, '.agents')
              : catalogFile;
        await rm(file, { recursive: true, force: true });
        await mkdir(path.dirname(file), { recursive: true });
        const target = path.join(root, 'bad-target');
        if (kind === 'wrong-type') {
          if (location === 'catalog') await mkdir(target);
          else await writeFile(target, 'not a directory');
        }
        await symlink(kind === 'loop' ? file : target, file);
        await assert.rejects(run());
        assert.deepEqual(calls, []);
        assert.equal((await lstat(file)).isSymbolicLink(), true);
      });
    }
  }

  for (const phase of ['preflight', 'register', 'install', 'readback']) {
    it(
      'should report completed work, remaining operations, and child errors after ' +
        phase +
        ' failure',
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
  it('should detect intervening catalog edits before any filesystem changes', async () => {
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
  it('should not infer installation from an empty successful native response', async () => {
    hook = async (argv) => {
      if (argv[1] === 'list') installed = null;
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /not observed/);
    assert.ok(result.remaining[0]);
    assert.equal(result.remaining[0].operation, 'readback');
  });
  it('should keep a disabled installation disabled on repeated install', async () => {
    assert.equal((await run()).ok, true);
    assert.ok(installed);
    installed.enabled = false;
    const result = await run();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'installed_pending_enablement');
  });
  it('should use strict positional/option/environment precedence', () => {
    assert.equal(
      parseArgs(['install', '/positional'], { CODEX_TOOLS_REPO_ROOT: '/env' }).repoRoot,
      '/positional',
    );
    assert.throws(() => parseArgs(['install', '/one', '/two'], {}));
    assert.throws(() => parseArgs(['install', '/one', '--repo-root', '/two'], {}));
    assert.throws(() => parseArgs(['status', '--marketplace-path', catalogFile], {}));
  });
});
