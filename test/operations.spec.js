import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOperation } from '../lib/operations.js';
import { resolveContext } from '../lib/context.js';

describe('installation diagnostics and consumer compatibility (adapted from Agentbox)', () => {
  let root, repoRoot, codexHome, cachePath, options;
  const manifest = { name: 'sample', version: '1.0.0' };
  async function writeJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  async function install(target = cachePath, value = manifest) {
    await writeJson(path.join(target, '.codex-plugin/plugin.json'), value);
  }
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codex-tools-operations-'));
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

  it('discovers an exact manifest version without assuming the directory name', async () => {
    await install();
    const context = await resolveContext(options);
    assert.equal(context.cachePath, cachePath);
    assert.equal(context.marketplace, 'custom');
    assert.equal(context.inspection.installed, true);
    assert.equal(context.inspection.registered, null);
  });
  it('uses plugin cachebuster identity rather than the package version', async () => {
    const value = { ...manifest, version: '1.0.0+codex.local' };
    await writeJson(path.join(repoRoot, '.codex-plugin/plugin.json'), value);
    await install(cachePath, value);
    assert.equal((await resolveContext(options)).inspection.installed, true);
  });
  it('reports local registration and disabled state independently of cache identity', async () => {
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
  it('rejects malformed configuration before modifying a target', async () => {
    await install();
    await writeFile(path.join(codexHome, 'config.toml'), 'not valid toml ]');
    await assert.rejects(runOperation('sync', options));
    await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
  });
  it('makes missing installation checks explicitly neutral while refusing sync', async () => {
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
    it('reports a ' + label + ' cached manifest without repairing it', async () => {
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
  it('lists other versions without selecting an incompatible target', async () => {
    await install(cachePath, { ...manifest, version: '0.9.0' });
    const result = await runOperation('status', options);
    assert.equal(result.cachePath, null);
    assert.equal(result.candidates[0].version, '0.9.0');
    assert.equal(result.ok, false);
  });
  it('refuses ambiguous markets or versions until an explicit override resolves them', async () => {
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
  it('does not let a conflicting marketplace override redirect sync', async () => {
    await install();
    const result = await runOperation('sync', {
      ...options,
      cachePathOverride: cachePath,
      marketplace: 'wrong',
    });
    assert.equal(result.status, 'unresolved');
    await assert.rejects(lstat(path.join(cachePath, 'managed.txt')), { code: 'ENOENT' });
  });
  it('preserves unmanaged files and converges without replacing matching files', async () => {
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
  it('never labels an explicit raw target as installed, including later checks', async () => {
    const raw = path.join(root, 'raw');
    const selected = {
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
  it('does not infer a raw creation target', async () => {
    assert.equal((await runOperation('sync', { ...options, missingTarget: 'create' })).ok, false);
    await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
  });
  it('dry run and status leave existing cache contents unchanged', async () => {
    await install();
    await writeFile(path.join(cachePath, 'managed.txt'), 'old');
    const before = await lstat(path.join(cachePath, 'managed.txt'));
    const result = await runOperation('sync', { ...options, dryRun: true });
    assert.equal(result.status, 'planned');
    assert.deepEqual(result.diff.changed, ['managed.txt']);
    await runOperation('status', options);
    assert.equal(await readFile(path.join(cachePath, 'managed.txt'), 'utf8'), 'old');
    assert.equal((await lstat(path.join(cachePath, 'managed.txt'))).mtimeMs, before.mtimeMs);
  });
  it('refuses an aliased cache installation', async () => {
    const outside = path.join(root, 'outside');
    await install(outside);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await symlink(outside, cachePath);
    assert.equal(
      (await runOperation('sync', { ...options, cachePathOverride: cachePath })).status,
      'unresolved',
    );
    await assert.rejects(lstat(path.join(outside, 'managed.txt')), { code: 'ENOENT' });
  });
});
