import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runOperation } from '@tanaab/codex-tools';
const root = process.argv[2];
const source = path.join(root, 'source');
const target = path.join(root, 'target');
const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
await writeJson(path.join(source, 'package.json'), {
  version: '1.0.0',
  codexTools: { managedPaths: ['managed.txt'] },
});
await writeJson(path.join(source, '.codex-plugin/plugin.json'), {
  name: 'sample',
  version: '1.0.0',
});
await writeFile(path.join(source, 'managed.txt'), 'source');
await mkdir(target);
await writeFile(path.join(target, 'unmanaged.txt'), 'preserve');
const options = {
  repoRoot: source,
  cachePathOverride: target,
  codexHome: path.join(root, 'codex'),
  missingTarget: 'create',
};
const preview = await runOperation('sync', { ...options, dryRun: true });
assert.equal(preview.status, 'planned');
await assert.rejects(lstat(path.join(target, 'managed.txt')), { code: 'ENOENT' });
assert.equal(await readFile(path.join(target, 'unmanaged.txt'), 'utf8'), 'preserve');
assert.equal((await runOperation('sync', options)).status, 'synchronized_directory');
assert.equal((await runOperation('check', options)).status, 'synchronized_directory');
const before = await lstat(path.join(target, 'managed.txt'));
assert.equal((await runOperation('sync', options)).ok, true);
const after = await lstat(path.join(target, 'managed.txt'));
assert.equal(after.ino, before.ino);
assert.equal(after.mtimeMs, before.mtimeMs);
assert.equal(await readFile(path.join(target, 'unmanaged.txt'), 'utf8'), 'preserve');
