/**
 * Reports whether a normalized diff contains any drift.
 *
 * @param {{changed: string[], extra: string[], missing: string[]}} diff Entry diff.
 * @returns {boolean} Whether drift exists.
 */
import type { TreeDiff } from './diff-entries.ts';

export default function hasDiff(diff: TreeDiff): boolean {
  return diff.changed.length > 0 || diff.missing.length > 0 || diff.extra.length > 0;
}
