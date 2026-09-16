import { lstat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

import { hasErrorCode } from './errors.ts';

export type StatPath = (targetPath: string) => Promise<Stats>;

export default async function pathExists(
  targetPath: string,
  statPath: StatPath = (file) => lstat(file),
): Promise<boolean> {
  try {
    await statPath(targetPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}
