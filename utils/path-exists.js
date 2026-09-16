import { lstat } from 'node:fs/promises';

export default async function pathExists(targetPath, statPath = lstat) {
  try {
    await statPath(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
