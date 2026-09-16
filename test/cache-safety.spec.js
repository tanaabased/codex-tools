import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectEntries, inspectTrees, syncEntries } from '../lib/cache.js';

describe('scope and dry-run safeguards', () => {
  let root, sourceRoot, targetRoot;
  const aligned = { changed: [], extra: [], missing: [] };
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codex-tools-safety-'));
    sourceRoot = path.join(root, 'source');
    targetRoot = path.join(root, 'target');
    await mkdir(sourceRoot);
    await mkdir(targetRoot);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('preserves excluded descendants of extra directories and converges', async () => {
    await mkdir(path.join(targetRoot, 'extra/nested/node_modules'), { recursive: true });
    await writeFile(path.join(targetRoot, 'extra/nested/node_modules/keep'), 'safe');
    await writeFile(path.join(targetRoot, 'extra/delete'), 'remove');
    assert.deepEqual(await syncEntries({ sourceRoot, targetRoot }), aligned);
    assert.deepEqual((await inspectTrees({ sourceRoot, targetRoot })).diff, aligned);
    assert.deepEqual(await syncEntries({ sourceRoot, targetRoot }), aligned);
    assert.equal(
      await readFile(path.join(targetRoot, 'extra/nested/node_modules/keep'), 'utf8'),
      'safe',
    );
  });
  it('refuses type replacement over excluded contents before any deletion', async () => {
    await writeFile(path.join(sourceRoot, 'entry'), 'new');
    await mkdir(path.join(targetRoot, 'entry/.git'), { recursive: true });
    await writeFile(path.join(targetRoot, 'entry/.git/keep'), 'safe');
    await writeFile(path.join(targetRoot, 'extra'), 'also safe');
    const before = await collectEntries(targetRoot);
    await assert.rejects(syncEntries({ sourceRoot, targetRoot }), /ignored content/);
    assert.deepEqual(await collectEntries(targetRoot), before);
  });
  it('does not follow an intermediate symlink in a scoped path', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'entry'), 'safe');
    await mkdir(path.join(sourceRoot, 'dir'));
    await writeFile(path.join(sourceRoot, 'dir/entry'), 'new');
    await symlink(outside, path.join(targetRoot, 'dir'));
    await assert.rejects(
      syncEntries({ sourceRoot, targetRoot, managedPaths: ['dir/entry'] }),
      /parent/,
    );
    assert.equal(await readFile(path.join(outside, 'entry'), 'utf8'), 'safe');
  });
  it('supports scoped leaves without taking ownership of sibling files', async () => {
    for (const directory of [sourceRoot, targetRoot]) await mkdir(path.join(directory, 'bin'));
    await writeFile(path.join(sourceRoot, 'bin/tool.js'), 'new');
    await writeFile(path.join(targetRoot, 'bin/keep.js'), 'safe');
    assert.deepEqual(
      await syncEntries({ sourceRoot, targetRoot, managedPaths: ['bin/tool.js'] }),
      aligned,
    );
    assert.equal(await readFile(path.join(targetRoot, 'bin/keep.js'), 'utf8'), 'safe');
  });
  it('keeps a dry-run snapshot unchanged while reporting additions and deletions', async () => {
    await writeFile(path.join(sourceRoot, 'new'), 'new');
    await writeFile(path.join(targetRoot, 'old'), 'old');
    const before = await collectEntries(targetRoot);
    const diff = await syncEntries({ sourceRoot, targetRoot, dryRun: true });
    assert.deepEqual(diff, { changed: [], extra: ['old'], missing: ['new'] });
    assert.deepEqual(await collectEntries(targetRoot), before);
  });
  for (const managedPaths of [
    ['../outside'],
    ['/outside'],
    ['.'],
    ['dir/../outside'],
    ['.git'],
    [],
  ]) {
    it('rejects invalid scope ' + JSON.stringify(managedPaths), async () => {
      await assert.rejects(syncEntries({ sourceRoot, targetRoot, managedPaths }), /[Mm]anaged/);
    });
  }
});
