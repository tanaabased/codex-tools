import type { TreeDiff } from './diff-entries.ts';

export default function hasDiff(diff: TreeDiff): boolean {
  return diff.changed.length > 0 || diff.missing.length > 0 || diff.extra.length > 0;
}
