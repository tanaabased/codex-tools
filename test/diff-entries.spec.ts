import assert from 'node:assert/strict';

import diffCodexsyncEntries from '../utils/diff-entries.ts';
import type { FileEntry, SymlinkEntry, TreeEntry } from '../utils/diff-entries.ts';
import codexsyncDiffHasChanges from '../utils/has-diff.ts';

function fileEntry(content: string, mode = 0o644): FileEntry {
  return { content: Buffer.from(content), mode, type: 'file' };
}

function symlinkEntry(target: string): SymlinkEntry {
  return { target, type: 'symlink' };
}

describe('utils/diff-entries', () => {
  it('should report matching entries as current', () => {
    const source = new Map<string, TreeEntry>([
      ['file.txt', fileEntry('same')],
      ['link', symlinkEntry('target')],
    ]);
    const target = new Map<string, TreeEntry>([
      ['file.txt', fileEntry('same')],
      ['link', symlinkEntry('target')],
    ]);

    const diff = diffCodexsyncEntries(source, target);

    assert.deepEqual(diff, { changed: [], extra: [], missing: [] });
    assert.equal(codexsyncDiffHasChanges(diff), false);
  });

  it('should report content, mode, type, and symlink drift', () => {
    const source = new Map<string, TreeEntry>([
      ['content.txt', fileEntry('source')],
      ['mode.txt', fileEntry('same', 0o755)],
      ['shape', { type: 'dir' }],
      ['link', symlinkEntry('source-target')],
    ]);
    const target = new Map<string, TreeEntry>([
      ['content.txt', fileEntry('target')],
      ['mode.txt', fileEntry('same')],
      ['shape', fileEntry('wrong type')],
      ['link', symlinkEntry('target-target')],
    ]);

    const diff = diffCodexsyncEntries(source, target);

    assert.deepEqual(diff.changed, ['content.txt', 'link', 'mode.txt', 'shape']);
    assert.equal(codexsyncDiffHasChanges(diff), true);
  });

  it('should report sorted missing and extra entries', () => {
    const diff = diffCodexsyncEntries(
      new Map<string, TreeEntry>([
        ['b.txt', fileEntry('b')],
        ['a.txt', fileEntry('a')],
      ]),
      new Map<string, TreeEntry>([
        ['b.txt', fileEntry('b')],
        ['d.txt', fileEntry('d')],
        ['c.txt', fileEntry('c')],
      ]),
    );

    assert.deepEqual(diff.missing, ['a.txt']);
    assert.deepEqual(diff.extra, ['c.txt', 'd.txt']);
  });
});
