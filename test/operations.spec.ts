import assert from 'node:assert/strict';
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
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { CodexToolsOptions } from '../utils/parse-args.ts';
import { resolveContext } from '../lib/context.ts';
import { runOperation } from '../lib/operations.ts';

describe('lib/operations', () => {
  let root = '';
  let repoRoot = '';
  let codexHome = '';
  let cachePath = '';
  let options: CodexToolsOptions = {};
  const manifest = { name: 'sample', version: '1.0.0' };
  async function writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  async function install(
    target = cachePath,
    value: { name: string; version: string } = manifest,
  ): Promise<void> {
    await writeJson(path.join(target, '.codex-plugin/plugin.json'), value);
  }
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-operations-')));
    repoRoot = path.join(root, 'source');
    codexHome = path.join(root, 'codex');
    cachePath = path.join(codexHome, 'plugins/cache/custom/sample/arbitrary-cachebuster');
    options = { repoRoot, codexHome };
    await writeJson(path.join(repoRoot, 'package.json'), {
      version: '1.0.0',
      codexTools: { managedPaths: ['managed.txt'] },
    });
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), manifest);
    await writeFile(path.join(repoRoot, 'managed.txt'), 'source');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should keep read-only commands independent of managed Codex provisioning', async () => {
    let provisions = 0;
    const runtime = {
      provision: async () => {
        provisions += 1;
        throw new Error('read-only commands must not provision Codex');
      },
    };
    for (const command of ['status', 'doctor', 'check'] as const) {
      const result = await runOperation(command, options, runtime);
      assert.equal(result.command, command);
    }
    assert.equal(provisions, 0);
  });

  for (const [label, override, expected] of [
    ['inherit repository selection when omitted', {}, ['managed.txt']],
    [
      'select the whole tree for explicit null',
      { managedPaths: null },
      ['extra.txt', 'managed.txt', 'package.json'],
    ],
    [
      'replace repository selection with explicit paths',
      { managedPaths: ['extra.txt'] },
      ['extra.txt'],
    ],
  ] satisfies Array<[string, CodexToolsOptions, string[]]>) {
    it('should ' + label, async () => {
      await install();
      await writeFile(path.join(repoRoot, 'extra.txt'), 'extra');
      const selected = { ...options, ...override };
      assert.deepEqual((await runOperation('check', selected)).diff?.missing, expected);
      assert.equal((await runOperation('sync', selected)).ok, true);
      for (const file of ['managed.txt', 'extra.txt', 'package.json']) {
        if (expected.includes(file)) {
          assert.equal(
            await readFile(path.join(cachePath, file), 'utf8'),
            await readFile(path.join(repoRoot, file), 'utf8'),
          );
        } else {
          await assert.rejects(lstat(path.join(cachePath, file)), { code: 'ENOENT' });
        }
      }
    });
  }

  it('should discover an exact manifest version without assuming the directory name', async () => {
    await install();
    const context = await resolveContext(options);
    assert.equal(context.cachePath, cachePath);
    assert.equal(context.marketplace, 'custom');
    assert.equal(context.inspection.installed, true);
    assert.equal(context.inspection.registered, null);
  });
  it('should use plugin cachebuster identity rather than the package version', async () => {
    const value = { ...manifest, version: '1.0.0+codex.local' };
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), value);
    await install(cachePath, value);
    assert.equal((await resolveContext(options)).inspection.installed, true);
  });
  for (const marketplace of ['custom', 'wrong']) {
    it(
      'should resolve an explicit cache through a home alias with marketplace ' + marketplace,
      async () => {
        await install();
        const alias = path.join(root, 'codex-alias');
        await symlink(codexHome, alias);
        const selected = {
          ...options,
          codexHome: alias,
          cachePathOverride: path.join(alias, path.relative(codexHome, cachePath)),
          marketplace,
        };
        const context = await resolveContext(selected);
        assert.equal(context.cachePath, cachePath);
        assert.equal(context.inspection.installed, marketplace === 'custom');
        if (marketplace === 'wrong') {
          assert.equal((await runOperation('sync', selected)).status, 'unresolved');
          await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
        }
      },
    );
  }
  it('should report local registration and disabled state independently of cache identity', async () => {
    await install();
    await writeFile(
      path.join(codexHome, 'config.toml'),
      '[plugins."sample@custom"]\nenabled = false\n',
    );
    const result = await runOperation('status', options);
    assert.equal(result.inspection.registered, true);
    assert.equal(result.inspection.enabled, false);
    assert.equal(result.inspection.installed, true);
  });
  it('should reject malformed configuration before modifying a target', async () => {
    await install();
    await writeFile(path.join(codexHome, 'config.toml'), 'not valid toml ]');
    await assert.rejects(runOperation('sync', options));
    await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
  });
  it('should make missing installation checks explicitly neutral while refusing sync', async () => {
    const check = await runOperation('check', { ...options, absentCheck: 'neutral' });
    assert.equal(check.ok, true);
    assert.equal(check.status, 'not_installed');
    assert.equal((await runOperation('check', options)).ok, false);
    assert.equal((await runOperation('sync', { ...options, absentCheck: 'neutral' })).ok, false);
    await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
  });
  for (const [label, value] of [
    ['missing', undefined],
    ['invalid', '{'],
    ['null', 'null'],
    ['wrong name', { name: 'other', version: '1.0.0' }],
    ['wrong version', { name: 'sample', version: '0.9.0' }],
  ]) {
    it('should report a ' + label + ' cached manifest without repairing it', async () => {
      await mkdir(path.join(cachePath, '.codex-plugin'), { recursive: true });
      if (value !== undefined)
        await writeFile(
          path.join(cachePath, '.codex-plugin/plugin.json'),
          typeof value === 'string' ? value : JSON.stringify(value),
        );
      const selected = { ...options, cachePathOverride: cachePath };
      const check = await runOperation('check', { ...selected, absentCheck: 'neutral' });
      assert.equal(check.status, 'not_installed');
      assert.equal(check.ok, true);
      assert.ok(check.inspection.issue);
      assert.equal((await runOperation('sync', selected)).ok, false);
      await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
    });
  }
  it('should list other versions without selecting an incompatible target', async () => {
    await install(cachePath, { ...manifest, version: '0.9.0' });
    const result = await runOperation('status', options);
    assert.equal(result.cachePath, null);
    assert.equal(result.candidates[0]?.version, '0.9.0');
    assert.equal(result.ok, false);
  });
  it('should refuse ambiguous markets or versions until an explicit override resolves them', async () => {
    await install();
    const other = path.join(codexHome, 'plugins/cache/second/sample/other');
    await install(other);
    assert.equal((await runOperation('sync', options)).status, 'unresolved');
    assert.equal((await resolveContext({ ...options, marketplace: 'second' })).cachePath, other);
    await install(path.join(codexHome, 'plugins/cache/second/sample/duplicate'));
    assert.equal(
      (await runOperation('sync', { ...options, marketplace: 'second' })).status,
      'unresolved',
    );
    assert.equal((await runOperation('sync', { ...options, cachePathOverride: other })).ok, true);
  });
  it('should not let a conflicting marketplace override redirect sync', async () => {
    await install();
    const result = await runOperation('sync', {
      ...options,
      cachePathOverride: cachePath,
      marketplace: 'wrong',
    });
    assert.equal(result.status, 'unresolved');
    await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
  });
  it('should preserve unmanaged files and converge without replacing matching files', async () => {
    await install();
    await writeFile(path.join(cachePath, 'unmanaged.txt'), 'preserve');
    assert.equal((await runOperation('check', options)).status, 'drifted');
    assert.equal((await runOperation('sync', options)).ok, true);
    const before = await lstat(path.join(cachePath, 'managed.txt'));
    assert.equal((await runOperation('sync', options)).ok, true);
    const after = await lstat(path.join(cachePath, 'managed.txt'));
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(await readFile(path.join(cachePath, 'unmanaged.txt'), 'utf8'), 'preserve');
    assert.equal((await runOperation('doctor', options)).status, 'current');
  });
  it('should never label an explicit raw target as installed, including later checks', async () => {
    const raw = path.join(root, 'raw');
    const selected: CodexToolsOptions = {
      ...options,
      cachePathOverride: raw,
      missingTarget: 'create',
      managedPaths: null,
    };
    const preview = await runOperation('sync', { ...selected, dryRun: true });
    assert.equal(preview.status, 'planned');
    await assert.rejects(lstat(raw), { code: 'ENOENT' });
    assert.equal((await runOperation('sync', selected)).status, 'synchronized_directory');
    const checked = await runOperation('check', selected);
    assert.equal(checked.status, 'synchronized_directory');
    assert.equal(checked.inspection.installed, false);
    assert.equal(
      (await runOperation('sync', { ...selected, missingTarget: 'require-installed' })).ok,
      false,
    );
  });
  it('should not infer a raw creation target', async () => {
    assert.equal((await runOperation('sync', { ...options, missingTarget: 'create' })).ok, false);
    await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
  });
  it('should leave existing cache contents unchanged during dry run and status', async () => {
    await install();
    await writeFile(path.join(cachePath, 'managed.txt'), 'old');
    const before = await lstat(path.join(cachePath, 'managed.txt'));
    const result = await runOperation('sync', { ...options, dryRun: true });
    assert.equal(result.status, 'planned');
    assert.ok(result.diff);
    assert.deepEqual(result.diff.changed, ['managed.txt']);
    await runOperation('status', options);
    assert.equal(await readFile(path.join(cachePath, 'managed.txt'), 'utf8'), 'old');
    assert.equal((await lstat(path.join(cachePath, 'managed.txt'))).mtimeMs, before.mtimeMs);
  });
  it('should refuse an aliased cache installation', async () => {
    const outside = path.join(root, 'outside');
    await install(outside);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await symlink(outside, cachePath);
    assert.equal(
      (await runOperation('sync', { ...options, cachePathOverride: cachePath })).status,
      'unresolved',
    );
    const alias = path.join(root, 'codex-alias');
    await symlink(codexHome, alias);
    assert.equal(
      (
        await runOperation('sync', {
          ...options,
          codexHome: alias,
          cachePathOverride: path.join(alias, path.relative(codexHome, cachePath)),
        })
      ).status,
      'unresolved',
    );
    await assert.rejects(lstat(path.join(outside, 'managed.txt')), { code: 'ENOENT' });
  });
});
