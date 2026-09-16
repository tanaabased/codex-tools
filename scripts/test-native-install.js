import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/codex-tools', import.meta.url));
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
  const invoke = (...extra) => {
    const child = spawnSync(cli, ['install', source, '--json', ...extra], {
      cwd: home,
      env,
      encoding: 'utf8',
      timeout: 45000,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout || child.error?.message);
    return JSON.parse(child.stdout);
  };
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
  assert.equal(repeated.completed.find((step) => step.operation === 'install').skipped, true);
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
  process.stdout.write(
    'Codex 0.153.x native smoke passed: fresh home, external source, payload readback, repeat install, and explicit marketplace.\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
