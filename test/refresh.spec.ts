import assert from 'node:assert/strict';
import {
  chmod,
  cp,
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { CodexToolsOptions } from '../utils/parse-args.ts';
import type {
  InstallationEffects,
  InstallationResult,
  ManifestEdit,
} from '../lib/install-types.ts';
import type { NativeResult, NativeRunner } from '../lib/codex-native.ts';
import { parseArgs } from '../utils/parse-args.ts';
import { refreshPlugin } from '../lib/refresh.ts';
import { renderResult } from '../lib/presentation.ts';
import { runOperation } from '../lib/operations.ts';
import { supportedCodexVersion } from '../lib/codex-native.ts';

const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};

describe('lib/refresh', () => {
  interface FixtureManifest {
    name: string;
    version: string;
    skills?: string;
  }
  interface InstalledFixture {
    pluginId: string;
    name?: string;
    marketplaceName?: string;
    version: string;
    installed: boolean;
    enabled: boolean;
    source?: { source: string; path: string };
  }
  let root = '';
  let home = '';
  let codexHome = '';
  let repoRoot = '';
  let manifestFile = '';
  let catalogFile = '';
  let mapping = '';
  let configFile = '';
  let env: NodeJS.ProcessEnv = {};
  let options: CodexToolsOptions = {};
  let calls: Array<readonly string[]> = [];
  let installed: InstalledFixture[] = [];
  let hook:
    ((argv: readonly string[]) => Promise<Partial<NativeResult> | null | undefined | void>) | null =
    null;
  let failure: ((argv: readonly string[]) => boolean) | null = null;
  let version = '';
  const now = new Date('2026-09-16T18:30:00Z');
  const readManifest = async (): Promise<FixtureManifest> =>
    JSON.parse(await readFile(manifestFile, 'utf8')) as FixtureManifest;
  const native: NativeRunner = async (argv) => {
    calls.push(argv);
    if (hook) {
      const replacement = await hook(argv);
      if (replacement) return { argv, exitCode: 0, stdout: '', stderr: '', ...replacement };
    }
    if (failure?.(argv))
      return { argv, exitCode: 37, stdout: 'partial child output', stderr: 'native failure' };
    if (argv[0] === '--version') return { argv, exitCode: 0, stdout: version, stderr: '' };
    let data;
    if (argv[1] === 'marketplace') data = { marketplaces: [{ name: 'personal', root: home }] };
    else if (argv[1] === 'list') data = { installed, available: [] };
    else if (argv[1] === 'add') {
      const manifest = await readManifest();
      const installedPath = path.join(
        await realpath(codexHome),
        'plugins/cache/personal/sample',
        manifest.version,
      );
      await cp(repoRoot, installedPath, { recursive: true });
      installed[0] = { ...installed[0]!, version: manifest.version };
      data = {
        pluginId: 'sample@personal',
        name: 'sample',
        marketplaceName: 'personal',
        version: manifest.version,
        installedPath,
      };
    } else throw new Error('Unexpected native command: ' + argv.join(' '));
    return { argv, exitCode: 0, stdout: JSON.stringify(data), stderr: '' };
  };
  type LocalRefreshResult = InstallationResult & {
    cachePath: string;
    effects: InstallationEffects;
    manifestEdit: ManifestEdit;
  };
  const run = async (extra: CodexToolsOptions = {}): Promise<LocalRefreshResult> => {
    const result = await refreshPlugin({ ...options, ...extra }, { env, native, now });
    if (!result.cachePath || !result.effects || !result.manifestEdit)
      throw new Error('Local refresh result omitted its required details.');
    return result as LocalRefreshResult;
  };
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-refresh-test-')));
    home = path.join(root, 'home');
    codexHome = path.join(root, 'codex');
    repoRoot = path.join(root, "source ' $(literal)");
    await mkdir(home);
    await mkdir(codexHome);
    manifestFile = path.join(repoRoot, '.codex-plugin/plugin.json');
    await writeJson(manifestFile, {
      name: 'sample',
      version: '1.2.3-beta.1+other',
      skills: './skills',
    });
    await mkdir(path.join(repoRoot, 'skills/probe'), { recursive: true });
    await writeFile(path.join(repoRoot, 'skills/probe/SKILL.md'), 'first payload');
    catalogFile = path.join(home, '.agents/plugins/marketplace.json');
    await writeJson(catalogFile, {
      name: 'personal',
      custom: true,
      plugins: [
        { name: 'unrelated', source: { source: 'npm', package: 'unrelated' } },
        { name: 'sample', source: { source: 'local', path: './plugins/sample' } },
      ],
    });
    mapping = path.join(home, 'plugins/sample');
    await mkdir(path.dirname(mapping));
    await symlink(repoRoot, mapping);
    configFile = path.join(codexHome, 'config.toml');
    await writeFile(
      configFile,
      '[plugins."sample@personal"]\nenabled = true\n[plugins."other@personal"]\nenabled = false\n',
    );
    env = { HOME: home, CODEX_HOME: codexHome, PATH: process.env.PATH };
    options = { repoRoot, codexHome };
    installed = [
      {
        pluginId: 'sample@personal',
        name: 'sample',
        marketplaceName: 'personal',
        version: '0.9.0',
        installed: true,
        enabled: true,
        source: { source: 'local', path: mapping },
      },
      { pluginId: 'other@personal', version: '1', enabled: false, installed: true },
    ];
    calls = [];
    hook = null;
    failure = null;
    version = 'codex-cli ' + supportedCodexVersion;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should refresh through linked home and catalog while preserving both links', async () => {
    const catalogTarget = path.join(root, 'catalog-target.json');
    const homeTarget = path.join(root, 'codex-target');
    await rename(catalogFile, catalogTarget);
    await symlink(catalogTarget, catalogFile);
    await rename(codexHome, homeTarget);
    await symlink(homeTarget, codexHome);
    const catalogBefore = await lstat(catalogFile);
    const homeBefore = await lstat(codexHome);
    const bytes = await readFile(catalogTarget, 'utf8');
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal((await lstat(catalogFile)).ino, catalogBefore.ino);
    assert.equal((await lstat(codexHome)).ino, homeBefore.ino);
    assert.equal(await readFile(catalogTarget, 'utf8'), bytes);
  });
  it('should reinstall stale and successive payloads without release bumps or same-second cache reuse', async () => {
    const catalogBefore = await readFile(catalogFile, 'utf8');
    const configBefore = await readFile(configFile, 'utf8');
    const linkBefore = await lstat(mapping);
    const first = await run();
    assert.equal(first.ok, true, first.issue ?? undefined);
    assert.equal(first.status, 'refreshed');
    assert.equal(first.manifestEdit.after, '1.2.3-beta.1+codex.20260916183000');
    assert.equal(first.inspection.payload, 'verified');
    assert.equal(first.inspection.activation, 'unknown');
    assert.match(first.guidance ?? '', /new Codex task/);
    await writeFile(path.join(repoRoot, 'skills/probe/SKILL.md'), 'second payload');
    const second = await run();
    assert.equal(second.ok, true, second.issue ?? undefined);
    assert.equal(second.manifestEdit.after, '1.2.3-beta.1+codex.20260916183001');
    assert.equal(
      await readFile(path.join(second.cachePath, 'skills/probe/SKILL.md'), 'utf8'),
      'second payload',
    );
    assert.equal(
      await readFile(path.join(first.cachePath, 'skills/probe/SKILL.md'), 'utf8'),
      'first payload',
    );
    assert.equal(await readFile(catalogFile, 'utf8'), catalogBefore);
    assert.equal(await readFile(configFile, 'utf8'), configBefore);
    assert.equal((await lstat(mapping)).ino, linkBefore.ino);
    assert.deepEqual(calls.filter((argv) => argv[1] === 'add')[0], [
      'plugin',
      'add',
      '--json',
      '--',
      'sample@personal',
    ]);
    assert.ok(!calls.some((argv) => argv.includes('remove')));
  });
  it('should preview the manifest edit and pending validation without a process or writes', async () => {
    const before = await readFile(manifestFile, 'utf8');
    const result = await run({ dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.manifestEdit.applied, false);
    assert.equal(result.inspection.installed, null);
    assert.match(result.issue ?? '', /pending/);
    const manifestStep = result.plan.find((step) => step.operation === 'edit-manifest');
    assert.ok(manifestStep);
    assert.equal(manifestStep.after, result.manifestEdit.after);
    assert.deepEqual(calls, []);
    assert.equal(await readFile(manifestFile, 'utf8'), before);
    assert.match(renderResult(result), /manifest: .* -> .* \(planned\)/);
  });
  it('should use the operation dispatcher and strict parser with positional precedence', async () => {
    assert.equal(
      parseArgs(['refresh', repoRoot], { CODEX_TOOLS_REPO_ROOT: '/other' }).repoRoot,
      repoRoot,
    );
    assert.throws(() => parseArgs(['refresh', '/one', '/two'], {}));
    assert.throws(() => parseArgs(['refresh', '/one', '--repo-root', '/two'], {}));
    assert.equal(
      parseArgs(['refresh', '--marketplace-path', catalogFile, '--dry-run'], {}).command,
      'refresh',
    );
    const result = await runOperation(
      'refresh',
      { ...options, dryRun: true },
      { env, native, now },
    );
    assert.equal(result.command, 'refresh');
    await assert.rejects(run({ managedPaths: ['skills'] }), /not an install option/);
  });
  for (const kind of [
    'missing catalog',
    'missing mapping',
    'mismatched mapping',
    'nonlocal entry',
    'duplicate entry',
    'no version',
    'symlink payload',
  ]) {
    it('should reject ' + kind + ' before effects', async () => {
      if (kind === 'missing catalog') await rm(catalogFile);
      if (kind.includes('mapping')) {
        await rm(mapping);
        if (kind === 'mismatched mapping') await symlink(home, mapping);
      }
      if (kind === 'nonlocal entry' || kind === 'duplicate entry') {
        const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
        if (kind === 'nonlocal entry')
          catalog.plugins[1].source = { source: 'git', url: 'https://example.invalid/plugin' };
        else catalog.plugins.push(catalog.plugins[1]);
        await writeJson(catalogFile, catalog);
      }
      if (kind === 'no version') await writeJson(manifestFile, { name: 'sample' });
      if (kind === 'symlink payload')
        await symlink('SKILL.md', path.join(repoRoot, 'skills/probe/link'));
      const before = await readFile(manifestFile, 'utf8');
      await assert.rejects(run());
      assert.deepEqual(calls, []);
      assert.equal(await readFile(manifestFile, 'utf8'), before);
    });
  }
  for (const kind of [
    'absent',
    'ambiguous',
    'mismatched',
    'nonlocal',
    'disabled',
    'unsupported version',
    'malformed JSON',
  ]) {
    it('should reject native ' + kind + ' before editing the manifest', async () => {
      if (kind === 'absent') installed.shift();
      if (kind === 'ambiguous') installed.push(installed[0]!);
      if (kind === 'mismatched') installed[0]!.source!.path = home;
      if (kind === 'nonlocal') installed[0]!.source!.source = 'git';
      if (kind === 'disabled') installed[0]!.enabled = false;
      if (kind === 'unsupported version') version = 'codex-cli 999.0.0';
      if (kind === 'malformed JSON')
        hook = async (argv) => (argv[1] === 'list' ? { stdout: '{' } : null);
      const before = await readFile(manifestFile, 'utf8');
      const result = await run();
      assert.equal(result.ok, false);
      assert.equal(result.manifestEdit.applied, false);
      assert.equal(result.effects.reinstallAttempted, false);
      assert.equal(await readFile(manifestFile, 'utf8'), before);
    });
  }
  for (const kind of ['source', 'catalog', 'config', 'mapping']) {
    it('should detect concurrent ' + kind + ' edits before mutation', async () => {
      hook = async (argv) => {
        if (argv[0] !== '--version') return;
        if (kind === 'source')
          await writeFile(path.join(repoRoot, 'skills/probe/SKILL.md'), 'concurrent');
        if (kind === 'catalog')
          await writeFile(catalogFile, (await readFile(catalogFile, 'utf8')) + '\n');
        if (kind === 'config') await writeFile(configFile, '# concurrent\n');
        if (kind === 'mapping') {
          await rm(mapping);
          await symlink(home, mapping);
        }
      };
      const result = await run();
      assert.equal(result.ok, false);
      assert.equal(result.manifestEdit.applied, false);
      assert.equal(result.effects.reinstallAttempted, false);
    });
  }
  for (const phase of ['preflight', 'reinstall', 'readback']) {
    it('should retain native errors and partial effects after ' + phase + ' failure', async () => {
      failure = (argv) =>
        phase === 'preflight'
          ? argv[0] === '--version'
          : phase === 'reinstall'
            ? argv[1] === 'add'
            : argv[1] === 'list' && calls.some((call) => call[1] === 'add');
      const result = await run();
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 37);
      assert.ok(result.nativeError);
      assert.equal(result.nativeError.stdout, 'partial child output');
      assert.ok(result.remaining[0]);
      assert.equal(result.remaining[0].operation, phase);
      assert.equal(result.manifestEdit.applied, phase !== 'preflight');
      if (phase !== 'preflight') {
        assert.equal((await readManifest()).version, result.manifestEdit.after);
        assert.match(result.nativeState ?? '', /may have changed/);
        assert.match(renderResult(result), /source manifest was edited/);
      }
    });
  }
  for (const kind of [
    'empty response',
    'invalid add JSON',
    'wrong version',
    'stale payload',
    'source edit',
    'config edit',
    'unrelated state',
  ]) {
    it(
      'should not turn a successful native exit with ' + kind + ' into refresh success',
      async () => {
        hook = async (argv) => {
          if (argv[1] === 'add' && kind === 'empty response') return { stdout: '{}' };
          if (argv[1] === 'add' && kind === 'invalid add JSON') return { stdout: '{' };
          if (argv[1] !== 'list' || !calls.some((call) => call[1] === 'add')) return;
          if (kind === 'wrong version') installed[0]!.version = 'old';
          if (kind === 'stale payload')
            await writeFile(
              path.join(
                codexHome,
                'plugins/cache/personal/sample',
                (await readManifest()).version,
                'skills/probe/SKILL.md',
              ),
              'wrong',
            );
          if (kind === 'source edit')
            await writeFile(path.join(repoRoot, 'skills/probe/SKILL.md'), 'concurrent');
          if (kind === 'config edit') await writeFile(configFile, '# lost state\n');
          if (kind === 'unrelated state') installed[1]!.enabled = true;
        };
        const result = await run();
        assert.equal(result.ok, false);
        assert.equal(result.manifestEdit.applied, true);
        assert.equal(result.effects.reinstallAttempted, true);
        assert.notEqual(result.effects.preservation, 'verified');
      },
    );
  }
  it('should refuse aliased cache parents before source edits', async () => {
    await mkdir(path.join(codexHome, 'plugins'));
    await symlink(home, path.join(codexHome, 'plugins/cache'));
    await assert.rejects(run(), /cache parent must be a real directory/);
    assert.deepEqual(calls, []);
  });
  it('should preserve manifest modes despite the process umask', async () => {
    await chmod(manifestFile, 0o664);
    const result = await run();
    assert.equal(result.ok, true, result.issue ?? undefined);
    assert.equal((await lstat(manifestFile)).mode & 0o777, 0o664);
  });
  it('should detect a cache version created after planning before editing the source', async () => {
    hook = async (argv) => {
      if (argv[0] === '--version')
        await mkdir(
          path.join(codexHome, 'plugins/cache/personal/sample/1.2.3-beta.1+codex.20260916183000'),
          { recursive: true },
        );
    };
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.issue ?? '', /already exists/);
    assert.equal(result.manifestEdit.applied, false);
  });
  it('should return the actual native child exit code and effects through CLI JSON', async () => {
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nprintf native-failure >&2\nexit 37\n', {
      mode: 0o755,
    });
    const cli = fileURLToPath(new URL('../bin/codex-tools.ts', import.meta.url));
    const child = spawnSync(process.execPath, [cli, 'refresh', repoRoot, '--json'], {
      cwd: home,
      env: { ...env, PATH: bin + path.delimiter + env.PATH },
      encoding: 'utf8',
    });
    assert.equal(child.status, 37, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.nativeError.exitCode, 37);
    assert.equal(result.manifestEdit.applied, false);
    assert.ok(!child.stdout.includes('\x1b'));
  });
});
