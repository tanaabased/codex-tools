import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
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

import { freshSkills } from '../lib/fresh-skills.ts';
import { supportedCodexFamily } from '../../lib/codex-native.ts';

const cli =
  process.env.CODEX_TOOLS_CLI ?? fileURLToPath(new URL('../../dist/codex-tools', import.meta.url));

interface SmokeResult {
  ok: boolean;
  status: string;
  error: string;
  cachePath: string;
  native: unknown[];
  inspection: Record<string, unknown>;
  manifestEdit: { applied: boolean; after: string };
  effects: { reinstallAttempted: boolean };
  nativeError: { exitCode: number };
  completed: Array<{ operation: string; skipped?: boolean }>;
  plan: Array<{ operation: string }>;
}
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-native-')));
try {
  const home = path.join(root, 'home');
  const codexHome = path.join(root, 'codex');
  const source = path.join(root, "external plugin ' $(literal)");
  await mkdir(home);
  await mkdir(path.join(source, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(source, 'skills/probe'), { recursive: true });
  await writeFile(
    path.join(source, '.codex-plugin/plugin.json'),
    JSON.stringify({
      name: 'codex-tools-smoke',
      version: '1.0.0',
      skills: './skills/',
    }),
  );
  await writeFile(
    path.join(source, 'skills/probe/SKILL.md'),
    '---\nname: probe\ndescription: Disposable installation probe.\n---\n\n# Probe\n\nReturn the word probe.\n',
  );
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: codexHome,
    TMPDIR: root,
    NO_COLOR: '1',
  };
  const invokeCommand = (
    command: string,
    extra: string[] = [],
    expectedExit: number | null = 0,
  ): SmokeResult => {
    const child = spawnSync(cli, [command, source, '--json', ...extra], {
      cwd: home,
      env,
      encoding: 'utf8',
      timeout: 45000,
    });
    if (expectedExit === null) assert.notEqual(child.status, 0, child.stdout);
    else
      assert.equal(
        child.status,
        expectedExit,
        child.stderr || child.stdout || child.error?.message,
      );
    return JSON.parse(child.stdout) as SmokeResult;
  };
  const invoke = (...extra: string[]) => invokeCommand('install', extra);
  const preview = invoke('--dry-run');
  assert.equal(preview.status, 'planned');
  assert.equal(preview.native.length, 0);
  await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
  const installed = invoke();
  assert.equal(installed.inspection.installed, true);
  assert.equal(installed.inspection.enabled, true);
  assert.equal(installed.inspection.authentication, 'unknown');
  assert.equal(installed.inspection.activation, 'unknown');
  const cached = path.join(codexHome, 'plugins/cache/personal/codex-tools-smoke/1.0.0');
  assert.equal(
    await readFile(path.join(cached, 'skills/probe/SKILL.md'), 'utf8'),
    await readFile(path.join(source, 'skills/probe/SKILL.md'), 'utf8'),
  );
  const catalogFile = path.join(home, '.agents/plugins/marketplace.json');
  const before = await lstat(catalogFile);
  const cacheBefore = await lstat(path.join(cached, '.codex-plugin/plugin.json'));
  const repeated = invoke();
  assert.equal(repeated.inspection.installed, true);
  assert.equal(repeated.completed.find((step) => step.operation === 'install')?.skipped, true);
  assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
  assert.equal((await lstat(path.join(cached, '.codex-plugin/plugin.json'))).ino, cacheBefore.ino);
  const selected = path.join(root, 'selected marketplace');
  await mkdir(selected);
  const explicit = invoke(
    '--marketplace',
    'selected',
    '--marketplace-path',
    path.join(selected, '.agents/plugins/marketplace.json'),
  );
  assert.equal(explicit.inspection.installed, true);
  assert.ok(explicit.completed.some((step) => step.operation === 'register-marketplace'));
  const selectedRepeat = invoke('--marketplace', 'selected');
  assert.equal(selectedRepeat.inspection.installed, true);
  assert.ok(!selectedRepeat.plan.some((step) => step.operation === 'register-marketplace'));
  const configFile = path.join(codexHome, 'config.toml');
  const configBeforeRefresh = await readFile(configFile, 'utf8');
  const catalogBeforeRefresh = await readFile(catalogFile, 'utf8');
  const selectedCache = path.join(codexHome, 'plugins/cache/selected/codex-tools-smoke/1.0.0');
  const selectedBytes = await readFile(path.join(selectedCache, 'skills/probe/SKILL.md'), 'utf8');
  const manifestFile = path.join(source, '.codex-plugin/plugin.json');
  const manifestBefore = await readFile(manifestFile, 'utf8');
  const refreshPreview = invokeCommand('refresh', ['--dry-run']);
  assert.equal(refreshPreview.manifestEdit.applied, false);
  assert.equal(refreshPreview.native.length, 0);
  assert.equal(await readFile(manifestFile, 'utf8'), manifestBefore);
  let refreshed: SmokeResult;
  for (const payload of ['second native payload', 'third native payload']) {
    await writeFile(path.join(source, 'skills/probe/SKILL.md'), payload);
    refreshed = invokeCommand('refresh');
    assert.equal(refreshed.status, 'refreshed');
    assert.equal(refreshed.inspection.payload, 'verified');
    assert.equal(refreshed.inspection.activation, 'unknown');
    assert.equal(
      await readFile(path.join(refreshed.cachePath, 'skills/probe/SKILL.md'), 'utf8'),
      payload,
    );
    assert.match(refreshed.manifestEdit.after, /^1\.0\.0\+codex\.\d{14}$/);
  }
  assert.equal(await readFile(configFile, 'utf8'), configBeforeRefresh);
  assert.equal(await readFile(catalogFile, 'utf8'), catalogBeforeRefresh);
  assert.equal(
    await readFile(path.join(selectedCache, 'skills/probe/SKILL.md'), 'utf8'),
    selectedBytes,
  );
  // a stale source version must still be refreshed through the selected local mapping.
  const changedManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  changedManifest.version = '2.0.0-beta.1+local';
  await writeFile(manifestFile, JSON.stringify(changedManifest));
  refreshed = invokeCommand('refresh', ['--marketplace', 'selected']);
  assert.match(refreshed.manifestEdit.after, /^2\.0\.0-beta\.1\+codex\.\d{14}$/);
  const mapping = path.join(home, 'plugins/codex-tools-smoke');
  await rm(mapping);
  await symlink(home, mapping);
  const mismatch = invokeCommand('refresh', [], 2);
  assert.match(mismatch.error, /source mapping/);
  await rm(mapping);
  await symlink(source, mapping);
  // a real native cache write failure must retain the source edit and child error.
  const cacheRoot = path.join(codexHome, 'plugins/cache/personal/codex-tools-smoke');
  await chmod(cacheRoot, 0o555);
  try {
    const failed = invokeCommand('refresh', [], null);
    assert.equal(failed.status, 'incomplete');
    assert.equal(failed.manifestEdit.applied, true);
    assert.equal(failed.effects.reinstallAttempted, true);
    assert.ok(failed.nativeError.exitCode > 0);
    assert.equal(
      JSON.parse(await readFile(manifestFile, 'utf8')).version,
      failed.manifestEdit.after,
    );
  } finally {
    await chmod(cacheRoot, 0o755);
  }
  assert.equal(invokeCommand('refresh').ok, true);

  const packageTarball = process.env.CODEX_TOOLS_PACKAGE;
  if (packageTarball) {
    const archive = await realpath(path.resolve(packageTarball));
    const extracted = path.join(root, 'packed-plugin');
    await mkdir(extracted);
    const unpacked = spawnSync('tar', ['-xzf', archive, '-C', extracted], {
      encoding: 'utf8',
    });
    assert.equal(unpacked.status, 0, unpacked.stderr);
    const packageRoot = await realpath(path.join(extracted, 'package'));
    assert.equal(packageRoot.startsWith(root + path.sep), true);
    const plugin = JSON.parse(
      await readFile(path.join(packageRoot, '.codex-plugin/plugin.json'), 'utf8'),
    ) as { name: string; version: string };
    assert.equal(plugin.name, 'codex-tools');

    const packagedHome = path.join(root, 'packaged-home');
    const packagedCodex = path.join(root, 'packaged-codex');
    await mkdir(packagedHome);
    const packagedEnv = {
      ...env,
      HOME: packagedHome,
      CODEX_HOME: packagedCodex,
    };
    const packagedInstall = spawnSync(cli, ['install', packageRoot, '--json'], {
      cwd: packagedHome,
      env: packagedEnv,
      encoding: 'utf8',
      timeout: 45000,
    });
    assert.equal(
      packagedInstall.status,
      0,
      packagedInstall.stderr || packagedInstall.stdout || packagedInstall.error?.message,
    );
    const packagedResult = JSON.parse(packagedInstall.stdout) as SmokeResult;
    assert.equal(packagedResult.inspection.installed, true);
    assert.equal(packagedResult.inspection.enabled, true);
    const cachedPlugin = path.join(
      packagedCodex,
      'plugins/cache/personal',
      plugin.name,
      plugin.version,
    );
    assert.equal(await realpath(cachedPlugin), cachedPlugin);
    for (const skill of ['tanaab-codex-tools-setup', 'tanaab-codex-tools-maintenance']) {
      const folder = skill.replace(/^tanaab-/, '');
      assert.ok(
        (await readFile(path.join(cachedPlugin, 'skills', folder, 'SKILL.md'), 'utf8')).includes(
          `name: ${skill}`,
        ),
      );
    }
    await freshSkills(packagedEnv, packagedHome, [
      'tanaab-codex-tools-setup',
      'tanaab-codex-tools-maintenance',
    ]);

    const packagedInput = path.join(root, 'packaged-input');
    const packagedTarget = path.join(root, 'packaged-target');
    await mkdir(path.join(packagedInput, '.codex-plugin'), { recursive: true });
    await writeFile(
      path.join(packagedInput, 'package.json'),
      JSON.stringify({ version: '1.0.0', codexTools: { managedPaths: ['payload.txt'] } }),
    );
    await writeFile(
      path.join(packagedInput, '.codex-plugin/plugin.json'),
      JSON.stringify({ name: 'packaged-probe', version: '1.0.0' }),
    );
    await writeFile(path.join(packagedInput, 'payload.txt'), 'packaged');
    const cachedCli = path.join(cachedPlugin, 'dist/codex-tools');
    const setup = spawnSync(cachedCli, ['install', packagedInput, '--dry-run', '--json'], {
      cwd: packagedHome,
      env: packagedEnv,
      encoding: 'utf8',
    });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.equal(JSON.parse(setup.stdout).status, 'planned');
    const maintenance = spawnSync(
      cachedCli,
      [
        'cache',
        'sync',
        '--repo-root',
        packagedInput,
        '--cache-path',
        packagedTarget,
        '--missing-target',
        'create',
        '--dry-run',
        '--json',
      ],
      { cwd: packagedHome, env: packagedEnv, encoding: 'utf8' },
    );
    assert.equal(maintenance.status, 0, maintenance.stderr || maintenance.stdout);
    assert.equal(JSON.parse(maintenance.stdout).status, 'planned');
    await assert.rejects(lstat(packagedTarget), { code: 'ENOENT' });
    process.stdout.write(
      'Packed plugin native smoke passed: external archive, Codex install, fresh-session discovery, and cached skill runtime invocation.\n',
    );
  }
  process.stdout.write(
    'Codex ' +
      supportedCodexFamily +
      ' native smoke passed: fresh home, external source, payload readback, repeat install, explicit marketplace, successive/stale refresh, preservation, mapping rejection, and failed native reinstall recovery.\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
