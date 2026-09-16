import path from 'node:path';

export const IGNORE_NAMES = ['.git', 'node_modules', '.DS_Store'];

export interface SelectionOptions {
  managedPaths?: readonly string[] | null;
  excludeNames?: readonly string[];
}

export interface Selection {
  managedPaths: string[] | null;
  ignored: Set<string>;
}

export function selection({
  managedPaths = null,
  excludeNames = [],
}: SelectionOptions = {}): Selection {
  if (
    !Array.isArray(excludeNames) ||
    excludeNames.some((p) => typeof p !== 'string' || !p || /[/\\]/.test(p))
  ) {
    throw new Error('excludeNames must contain path basenames.');
  }
  const ignored = new Set([...IGNORE_NAMES, ...excludeNames]);
  if (managedPaths === null) return { managedPaths, ignored };
  if (!Array.isArray(managedPaths) || !managedPaths.length) {
    throw new Error('managedPaths must be a nonempty array, or null for whole-tree selection.');
  }
  const paths = managedPaths
    .map((p) => {
      if (
        typeof p !== 'string' ||
        !p ||
        p.includes('\\') ||
        p.includes('\0') ||
        path.isAbsolute(p) ||
        p.split('/').some((part) => !part || part === '.' || part === '..' || ignored.has(part))
      ) {
        throw new Error('Managed paths must be relative, contained, non-ignored paths.');
      }
      return p;
    })
    .sort();
  return {
    ignored,
    managedPaths: paths.filter(
      (p, i) => !paths.slice(0, i).some((parent) => p === parent || p.startsWith(parent + '/')),
    ),
  };
}
