import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { collectEntries, syncEntries } from '../lib/cache.ts';
import pathExists from '../utils/path-exists.ts';
import type { StatPath } from '../utils/path-exists.ts';

const managedPaths = ['.mcp.json', 'assets', 'package.json', 'references', 'skills', 'AGENTS.md'];
const collectManagedEntries = (root: string, _entries: unknown, statPath: StatPath) =>
  collectEntries(root, { managedPaths, statPath });

async function createRoots() {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'piro-codexsync-cache-')));
  const sourceRoot = path.join(tempRoot, 'source');
  const targetRoot = path.join(tempRoot, 'target');
  await Promise.all([mkdir(sourceRoot), mkdir(targetRoot)]);
  return { sourceRoot, targetRoot, tempRoot };
}

async function syncRoots(sourceRoot: string, targetRoot: string, statPath: StatPath = lstat) {
  return syncEntries({ sourceRoot, targetRoot, managedPaths, statPath });
}

describe('lib/cache', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true })));
  });

  it('should treat only ENOENT as a missing cache path', async () => {
    const missing = async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    };
    assert.equal(await pathExists('/virtual/cache', missing), false);
    assert.deepEqual(await collectManagedEntries('/virtual/source', new Map(), missing), new Map());
  });

  for (const code of ['EACCES', 'EPERM', 'EIO', 'ENOTDIR']) {
    it(`should propagate ${code} when checking cache existence`, async () => {
      const failure = Object.assign(new Error('metadata probe failed'), { code });
      await assert.rejects(
        pathExists('/virtual/cache', async () => {
          throw failure;
        }),
        (error) => error === failure,
      );
    });

    for (const side of ['source', 'target']) {
      it(`should preserve cache files when nested ${side} metadata fails with ${code}`, async () => {
        const { sourceRoot, targetRoot, tempRoot } = await createRoots();
        tempRoots.push(tempRoot);
        for (const root of [sourceRoot, targetRoot]) {
          await mkdir(path.join(root, 'skills', 'voice'), { recursive: true });
          await writeFile(path.join(root, 'skills', 'voice', 'SKILL.md'), 'preserve skill\n');
        }
        const cached = path.join(targetRoot, 'skills', 'voice', 'SKILL.md');
        const denied = path.join(
          side === 'source' ? sourceRoot : targetRoot,
          'skills',
          'voice',
          'SKILL.md',
        );
        const failure = Object.assign(new Error('metadata probe failed'), { code });
        await assert.rejects(
          syncRoots(sourceRoot, targetRoot, async (targetPath) => {
            if (targetPath === denied) throw failure;
            return lstat(targetPath);
          }),
          (error) => error === failure,
        );
        assert.equal(await readFile(cached, 'utf8'), 'preserve skill\n');
      });
    }
  }

  it('should leave matching managed files untouched', async () => {
    const { sourceRoot, targetRoot, tempRoot } = await createRoots();
    tempRoots.push(tempRoot);
    const sourcePath = path.join(sourceRoot, '.mcp.json');
    const targetPath = path.join(targetRoot, '.mcp.json');
    await Promise.all([
      writeFile(sourcePath, '{"same":true}\n'),
      writeFile(targetPath, '{"same":true}\n'),
    ]);
    const preservedTime = new Date('2020-01-02T03:04:05.000Z');
    await utimes(targetPath, preservedTime, preservedTime);
    const before = await lstat(targetPath);

    const diff = await syncRoots(sourceRoot, targetRoot);
    const after = await lstat(targetPath);

    assert.deepEqual(diff, { changed: [], extra: [], missing: [] });
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  it('should update changed file content and mode', async () => {
    const { sourceRoot, targetRoot, tempRoot } = await createRoots();
    tempRoots.push(tempRoot);
    const sourcePath = path.join(sourceRoot, 'package.json');
    const targetPath = path.join(targetRoot, 'package.json');
    await Promise.all([writeFile(sourcePath, 'new\n'), writeFile(targetPath, 'old\n')]);
    await Promise.all([chmod(sourcePath, 0o640), chmod(targetPath, 0o600)]);

    const diff = await syncRoots(sourceRoot, targetRoot);
    const targetStats = await lstat(targetPath);

    assert.deepEqual(diff, { changed: [], extra: [], missing: [] });
    assert.equal(await readFile(targetPath, 'utf8'), 'new\n');
    assert.equal(targetStats.mode & 0o777, 0o640);
  });

  it('should add missing entries and remove extra entries', async () => {
    const { sourceRoot, targetRoot, tempRoot } = await createRoots();
    tempRoots.push(tempRoot);
    await mkdir(path.join(sourceRoot, 'skills', 'probe'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'skills', 'probe', 'SKILL.md'), 'probe\n');
    await mkdir(path.join(targetRoot, 'skills', 'obsolete'), { recursive: true });
    await writeFile(path.join(targetRoot, 'skills', 'obsolete', 'SKILL.md'), 'obsolete\n');

    const diff = await syncRoots(sourceRoot, targetRoot);

    assert.deepEqual(diff, { changed: [], extra: [], missing: [] });
    assert.equal(
      await readFile(path.join(targetRoot, 'skills', 'probe', 'SKILL.md'), 'utf8'),
      'probe\n',
    );
    await assert.rejects(lstat(path.join(targetRoot, 'skills', 'obsolete')));
  });

  it('should sync a managed root file and refresh a nested resource after an edit', async () => {
    const { sourceRoot, targetRoot, tempRoot } = await createRoots();
    tempRoots.push(tempRoot);
    const resource = path.join('references', 'guide.md');
    await mkdir(path.join(sourceRoot, 'references'));
    await writeFile(path.join(sourceRoot, 'AGENTS.md'), 'instructions');
    for (const content of ['original guide', 'updated guide']) {
      await writeFile(path.join(sourceRoot, resource), content);
      await syncRoots(sourceRoot, targetRoot);
      assert.equal(await readFile(path.join(targetRoot, 'AGENTS.md'), 'utf8'), 'instructions');
      assert.equal(await readFile(path.join(targetRoot, resource), 'utf8'), content);
    }
  });

  it('should replace entries when their filesystem type changes', async () => {
    const { sourceRoot, targetRoot, tempRoot } = await createRoots();
    tempRoots.push(tempRoot);
    await mkdir(path.join(sourceRoot, 'assets'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'assets', 'value.txt'), 'value\n');
    await symlink('elsewhere', path.join(targetRoot, 'assets'));

    const diff = await syncRoots(sourceRoot, targetRoot);
    const targetStats = await lstat(path.join(targetRoot, 'assets'));

    assert.deepEqual(diff, { changed: [], extra: [], missing: [] });
    assert.equal(targetStats.isDirectory(), true);
    assert.equal(await readFile(path.join(targetRoot, 'assets', 'value.txt'), 'utf8'), 'value\n');
  });
});
