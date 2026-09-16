import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import diffEntries from '../utils/diff-entries.js';
import pathExists from '../utils/path-exists.js';
import { selection } from '../utils/selection.js';

// Canon's snapshot/sync engine, reconciled with Me's scoped collector and error handling.
export async function collectEntries(root, options = {}) {
  const { managedPaths, ignored } = selection(options);
  const statPath = options.statPath ?? lstat;
  const entries = new Map();
  async function collect(relative) {
    const absolute = path.join(root, relative);
    let stats;
    try {
      stats = await statPath(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      entries.set(relative, { type: 'symlink', target: await readlink(absolute) });
    } else if (stats.isDirectory()) {
      entries.set(relative, { type: 'dir' });
      const names = (await readdir(absolute)).sort();
      for (const name of names) {
        if (!ignored.has(name)) await collect(path.join(relative, name));
      }
    } else if (stats.isFile()) {
      entries.set(relative, {
        type: 'file',
        mode: stats.mode & 0o777,
        content: await readFile(absolute),
      });
    } else {
      throw new Error('Unsupported filesystem entry: ' + absolute);
    }
  }
  if (managedPaths) {
    for (const relative of managedPaths) {
      // A scoped leaf never grants authority over an aliased or non-directory parent.
      let parent = path.dirname(relative);
      while (parent !== '.') {
        if (await pathExists(path.join(root, parent), statPath)) {
          const stats = await statPath(path.join(root, parent));
          if (!stats.isDirectory())
            throw new Error('Managed path parent is not a directory: ' + parent);
        }
        parent = path.dirname(parent);
      }
      await collect(relative);
    }
  } else {
    for (const name of (await readdir(root)).sort()) {
      if (!ignored.has(name)) await collect(name);
    }
  }
  return entries;
}

async function resolveSyncRoot(root) {
  try {
    return await realpath(root);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(root);
    if (parent === root) throw error;
    return path.join(await resolveSyncRoot(parent), path.basename(root));
  }
}

function containsPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function hasIgnored(directory, ignored) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) return true;
    if (entry.isDirectory() && (await hasIgnored(path.join(directory, entry.name), ignored)))
      return true;
  }
  return false;
}

async function scopedDiff(sourceEntries, targetEntries, targetRoot, options) {
  const diff = diffEntries(sourceEntries, targetEntries);
  const { ignored } = selection(options);
  const extra = [];
  for (const relative of diff.extra) {
    const hasSelectedLeaf = [...targetEntries].some(
      ([p, e]) => p.startsWith(relative + path.sep) && e.type !== 'dir',
    );
    if (
      targetEntries.get(relative).type === 'dir' &&
      !hasSelectedLeaf &&
      (await hasIgnored(path.join(targetRoot, relative), ignored))
    )
      continue;
    extra.push(relative);
  }
  return { ...diff, extra };
}

export async function inspectTrees({ sourceRoot: rawSource, targetRoot: rawTarget, ...options }) {
  const sourceRoot = await resolveSyncRoot(path.resolve(rawSource));
  const targetRoot = await resolveSyncRoot(path.resolve(rawTarget));
  if (containsPath(sourceRoot, targetRoot) || containsPath(targetRoot, sourceRoot)) {
    throw new Error('Cache operations require disjoint source and target directories.');
  }
  const statPath = options.statPath ?? lstat;
  if (!(await statPath(sourceRoot)).isDirectory())
    throw new Error('Source root is not a directory.');
  const targetPresent = await pathExists(targetRoot, statPath);
  if (targetPresent && !(await statPath(targetRoot)).isDirectory())
    throw new Error('Cache root is not a directory.');
  const sourceEntries = await collectEntries(sourceRoot, options);
  const targetEntries = targetPresent ? await collectEntries(targetRoot, options) : new Map();
  return {
    sourceRoot,
    targetRoot,
    sourceEntries,
    targetEntries,
    diff: await scopedDiff(sourceEntries, targetEntries, targetRoot, options),
  };
}

export async function syncEntries(options) {
  const { sourceRoot, targetRoot, sourceEntries, targetEntries, diff } =
    await inspectTrees(options);
  const updates = new Set([...diff.changed, ...diff.missing]);
  const { ignored } = selection(options);
  // Type replacement cannot recursively delete excluded descendants.
  for (const relative of diff.changed) {
    if (
      targetEntries.get(relative).type === 'dir' &&
      (await hasIgnored(path.join(targetRoot, relative), ignored))
    ) {
      throw new Error('Type replacement would remove ignored content: ' + relative);
    }
  }
  if (options.dryRun) return diff;
  const extras = [...diff.extra].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length || b.length - a.length,
  );
  for (const relative of extras) {
    const target = path.join(targetRoot, relative);
    if (targetEntries.get(relative).type === 'dir') {
      try {
        await rmdir(target);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
      }
    } else await rm(target);
  }
  const sorted = [...sourceEntries.entries()].sort(
    ([a], [b]) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b),
  );
  await mkdir(targetRoot, { recursive: true });
  for (const [relative, sourceEntry] of sorted) {
    if (!updates.has(relative)) continue;
    const target = path.join(targetRoot, relative);
    const targetEntry = targetEntries.get(relative);
    if (targetEntry) await rm(target, { force: true, recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    if (sourceEntry.type === 'dir') await mkdir(target, { recursive: true });
    else if (sourceEntry.type === 'symlink') await symlink(sourceEntry.target, target);
    else {
      // Write the inspected bytes to a new entry; never follow cached hard links or symlinks.
      await writeFile(target, sourceEntry.content, { flag: 'wx', mode: sourceEntry.mode });
      await chmod(target, sourceEntry.mode);
    }
  }
  const refreshed = await collectEntries(targetRoot, options);
  return scopedDiff(await collectEntries(sourceRoot, options), refreshed, targetRoot, options);
}
