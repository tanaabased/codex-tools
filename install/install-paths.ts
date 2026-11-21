import { lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { hasErrorCode } from '../utils/errors.ts';

type Identity = { ino: number; dev: number; mode: number; link?: string } | null;

async function identity(file: string): Promise<Identity> {
  try {
    const stats = await lstat(file);
    return {
      ino: stats.ino,
      dev: stats.dev,
      mode: stats.mode,
      ...(stats.isSymbolicLink() ? { link: await readlink(file) } : {}),
    };
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/** records traversed links and directory identities, not mutable directory timestamps. */
export class InstallPaths {
  private readonly nodes = new Map<string, Identity>();

  async resolve(file: string, type: 'directory' | 'file'): Promise<string> {
    let links = 0;
    const visit = async (
      target: string,
      required: boolean,
      targetType: 'directory' | 'file',
    ): Promise<string> => {
      let current = path.parse(target).root;
      const parts = target.slice(current.length).split(path.sep).filter(Boolean);
      for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        const node = await identity(current);
        const last = index === parts.length - 1;
        const directory = !last || targetType === 'directory';
        if (!node && required) throw new Error('Dangling installation path: ' + current);
        if (node?.link !== undefined) {
          if (++links > 40) throw new Error('Installation path symlink loop: ' + file);
          this.record(current, node);
          // resolve the complete link target before consuming the remaining path.
          current = await visit(
            path.isAbsolute(node.link) ? node.link : path.dirname(current) + path.sep + node.link,
            true,
            directory ? 'directory' : 'file',
          );
          const resolved = await lstat(current);
          if (directory ? !resolved.isDirectory() : !resolved.isFile())
            throw new Error('Wrong installation path target type: ' + file);
        } else {
          if (node) {
            const kind = node.mode & 0o170000;
            if (directory ? kind !== 0o040000 : kind !== 0o100000)
              throw new Error('Wrong installation path target type: ' + current);
          }
          // file contents and replacement identity belong to the caller's file snapshot.
          if (directory) this.record(current, node);
        }
      }
      return current;
    };
    return visit(path.resolve(file), false, type);
  }

  private record(file: string, node: Identity): void {
    if (this.nodes.has(file) && !isDeepStrictEqual(this.nodes.get(file), node))
      throw new Error('Installation path changed while planning: ' + file);
    this.nodes.set(file, node);
  }

  async unchanged(): Promise<void> {
    for (const [file, expected] of this.nodes) {
      if (!isDeepStrictEqual(await identity(file), expected))
        throw new Error('Installation path changed; rerun to replan: ' + file);
    }
  }

  async createdDirectory(physical: string): Promise<void> {
    for (const [file, expected] of this.nodes) {
      if (expected !== null || (file !== physical && !physical.startsWith(file + path.sep)))
        continue;
      const node = await identity(file);
      if (!node || (node.mode & 0o170000) !== 0o040000)
        throw new Error('Created installation directory changed: ' + file);
      this.nodes.set(file, node);
    }
    await this.unchanged();
  }
}
