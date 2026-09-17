export interface FileEntry {
  type: 'file';
  mode: number;
  content: Uint8Array;
}

export interface DirectoryEntry {
  type: 'dir';
}

export interface SymlinkEntry {
  type: 'symlink';
  target: string;
}

/** Normalized managed-tree entry used for comparison and synchronization. */
export type TreeEntry =
  | { type: 'file'; mode: number; content: Uint8Array }
  | { type: 'dir' }
  | { type: 'symlink'; target: string };
/** Relative-path map representing one normalized managed tree. */
export type EntryMap = Map<string, TreeEntry>;

/** Directional differences required to make a target match its source. */
export interface TreeDiff {
  changed: string[];
  extra: string[];
  missing: string[];
}

function contentEquals(leftContent: Uint8Array, rightContent: Uint8Array): boolean {
  return Buffer.from(leftContent).equals(rightContent);
}

/**
 * Compares normalized managed-tree entry maps without reading or writing the filesystem.
 *
 * @param sourceEntries Desired source snapshot.
 * @param targetEntries Observed target snapshot.
 * @returns Sorted changed, extra, and missing relative paths without mutating either snapshot.
 */
export default function diffEntries(sourceEntries: EntryMap, targetEntries: EntryMap): TreeDiff {
  const changed = [];
  const extra = [];
  const missing = [];

  for (const [relativePath, sourceEntry] of sourceEntries) {
    const targetEntry = targetEntries.get(relativePath);
    if (!targetEntry) {
      missing.push(relativePath);
      continue;
    }

    if (sourceEntry.type !== targetEntry.type) {
      changed.push(relativePath);
      continue;
    }

    if (sourceEntry.type === 'file') {
      if (targetEntry.type !== 'file') continue;
      const sameMode = sourceEntry.mode === targetEntry.mode;
      const sameContent = contentEquals(sourceEntry.content, targetEntry.content);
      if (!sameMode || !sameContent) {
        changed.push(relativePath);
      }
      continue;
    }

    if (
      sourceEntry.type === 'symlink' &&
      targetEntry.type === 'symlink' &&
      sourceEntry.target !== targetEntry.target
    ) {
      changed.push(relativePath);
    }
  }

  for (const relativePath of targetEntries.keys()) {
    if (!sourceEntries.has(relativePath)) {
      extra.push(relativePath);
    }
  }

  return { changed: changed.sort(), extra: extra.sort(), missing: missing.sort() };
}
