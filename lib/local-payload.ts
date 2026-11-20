import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { EntryMap } from '../utils/diff-entries.ts';
import inside from '../utils/inside.ts';
import { IGNORE_NAMES } from '../utils/selection.ts';
import { readNativeResult, runNative } from './codex-native.ts';
import { object, optional, validateSource } from './install-context.ts';
import type { InstallContext } from './install-context.ts';
import type { NpmRunner } from './install-types.ts';

const standaloneIgnored = new Set([...IGNORE_NAMES, '.temp']);

export interface LocalPayload {
  entries: EntryMap;
  marketplacePath: string;
  unchanged(temporary?: string): Promise<void>;
  remove(): Promise<void>;
}

async function packFiles(
  root: string,
  scratch: string,
  env: NodeJS.ProcessEnv,
  npm: NpmRunner = (argv, options) => runNative(argv, { ...options, executable: 'npm' }),
): Promise<string[]> {
  const result = readNativeResult(
    await npm(
      [
        'pack',
        '.',
        '--dry-run',
        '--json',
        '--offline',
        '--ignore-scripts',
        '--workspaces=false',
        '--cache',
        path.join(scratch, 'npm-cache'),
      ],
      { cwd: root, env },
    ),
    {
      failureMessage:
        'Could not read local npm package files. Check that npm is available and package.json defines a valid package.',
    },
  );
  const files: unknown =
    Array.isArray(result) && result.length === 1 && object(result[0]) ? result[0].files : null;
  if (!Array.isArray(files)) throw new Error('npm did not return a local package file list.');
  return files
    .map((file: unknown) => {
      if (
        !object(file) ||
        typeof file.path !== 'string' ||
        file.path.includes('\\') ||
        file.path.split('/').some((part) => !part || part === '..' || part === '.')
      ) {
        throw new Error('npm returned an invalid local package path.');
      }
      return file.path;
    })
    .sort();
}

async function readTree(
  root: string,
  files: readonly string[] | null,
  excluded: ReadonlySet<string>,
  mode: 'install' | 'refresh' | 'package' | 'cache',
  expected?: EntryMap,
): Promise<EntryMap> {
  const entries: EntryMap = new Map();
  async function visit(relative: string, recurse: boolean): Promise<void> {
    if (excluded.has(relative)) {
      if (files) throw new Error('Local npm package includes installation state: ' + relative);
      return;
    }
    const target = path.join(root, relative);
    const stat = await lstat(target);
    if (stat.isDirectory()) {
      entries.set(relative, { type: 'dir' });
      if (recurse && (!expected || expected.get(relative)?.type === 'dir'))
        for (const child of (await readdir(target)).sort()) {
          if (mode === 'cache' || !standaloneIgnored.has(child))
            await visit(path.join(relative, child), true);
        }
    } else if (stat.isFile()) {
      const content =
        expected && expected.get(relative)?.type !== 'file'
          ? Buffer.alloc(0)
          : await readFile(target);
      entries.set(relative, { type: 'file', content, mode: stat.mode & 0o777 });
    } else if (stat.isSymbolicLink() && mode === 'cache') {
      entries.set(relative, { type: 'symlink', target: await readlink(target) });
    } else if (!(stat.isSymbolicLink() && mode === 'install')) {
      throw new Error('Local plugin payload requires regular files and directories: ' + relative);
    }
  }
  if (files) {
    for (const file of files) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) {
        const directory = path.join(...parts.slice(0, i));
        if (!entries.has(directory)) await visit(directory, false);
        if (entries.get(directory)?.type !== 'dir')
          throw new Error('Local package path must have real directory parents: ' + file);
      }
      await visit(file, false);
      if (entries.get(file)?.type !== 'file')
        throw new Error('Local package file is missing or is not a regular file: ' + file);
    }
  } else {
    for (const name of (await readdir(root)).sort()) {
      if (mode === 'cache' || !standaloneIgnored.has(name)) await visit(name, true);
    }
  }
  return entries;
}

export async function prepareLocalPayload(
  context: InstallContext,
  env: NodeJS.ProcessEnv,
  options: { npm?: NpmRunner; manifestText?: string } = {},
): Promise<LocalPayload> {
  const { source, packageSnapshot, catalog } = context;
  const pkg: unknown = JSON.parse(packageSnapshot?.text ?? '{}');
  const temporaryRoot = await realpath(tmpdir());
  if (inside(source.root, temporaryRoot))
    throw new Error(
      'The temporary directory for local installation must be outside the plugin source.',
    );
  const scratch = await mkdtemp(path.join(temporaryRoot, 'codex-tools-local-'));
  const remove = () => rm(scratch, { recursive: true, force: true });
  try {
    const files =
      object(pkg) && pkg.files !== undefined
        ? await packFiles(source.root, scratch, env, options.npm)
        : null;
    const excluded = new Set<string>();
    for (const target of [context.catalogFile, context.catalogTarget, context.mapping]) {
      if (target && inside(source.root, target)) excluded.add(path.relative(source.root, target));
    }
    const mode = files ? 'package' : options.manifestText === undefined ? 'install' : 'refresh';
    const snapshot = (temporary?: string) =>
      readTree(
        source.root,
        files,
        temporary ? new Set([...excluded, path.relative(source.root, temporary)]) : excluded,
        mode,
      );
    const original = await snapshot();
    const entries = new Map(original);
    const manifestPath = path.relative(source.root, source.file);
    const manifest = entries.get(manifestPath);
    if (manifest?.type !== 'file') throw new Error('Local package excludes the plugin manifest.');
    if (options.manifestText !== undefined) {
      entries.set(manifestPath, { ...manifest, content: Buffer.from(options.manifestText) });
    }
    const stage = path.join(scratch, 'payload');
    await mkdir(stage);
    for (const [file, entry] of entries) {
      const target = path.join(stage, file);
      if (entry.type === 'dir') await mkdir(target, { recursive: true });
      else if (entry.type === 'file') {
        await writeFile(target, entry.content, { flag: 'wx', mode: entry.mode });
        await chmod(target, entry.mode);
      }
    }
    await assertResources(source.root, stage);
    const marketplacePath = path.join(scratch, '.agents/plugins/marketplace.json');
    await mkdir(path.dirname(marketplacePath), { recursive: true });
    const entry = catalog.plugins.find((entry) => entry.name === source.manifest.name)!;
    await writeFile(
      marketplacePath,
      JSON.stringify({
        name: catalog.name,
        plugins: [{ ...entry, source: { source: 'local', path: './payload' } }],
      }),
      { flag: 'wx' },
    );
    return {
      entries,
      marketplacePath,
      async unchanged(temporary) {
        const current = await snapshot(temporary);
        const currentManifest = current.get(manifestPath);
        if (
          options.manifestText !== undefined &&
          isDeepStrictEqual(currentManifest, entries.get(manifestPath))
        )
          current.set(manifestPath, manifest);
        if (!isDeepStrictEqual(original, current))
          throw new Error('Source changed during installation; rerun with a stable source.');
      },
      remove,
    };
  } catch (error) {
    await remove();
    throw error;
  }
}

async function assertResources(source: string, stage: string): Promise<void> {
  const { manifest } = await validateSource(stage, { checkResources: true }).catch(
    (error: unknown) => {
      throw new Error(
        'Selected local payload has a missing or invalid plugin resource: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    },
  );
  const defaults = [
    ...(manifest.skills === undefined ? ['skills'] : []),
    ...(manifest.hooks === undefined ? ['hooks/hooks.json'] : []),
    ...(manifest.mcpServers === undefined ? ['.mcp.json'] : []),
    ...(manifest.apps === undefined ? ['.app.json'] : []),
  ];
  for (const resource of defaults) {
    if (
      (await optional(() => lstat(path.join(source, resource)))) &&
      !(await optional(() => lstat(path.join(stage, resource))))
    ) {
      throw new Error('Local package excludes a plugin resource: ' + resource);
    }
  }
  const hookConfig = typeof manifest.hooks === 'string' ? manifest.hooks : 'hooks/hooks.json';
  const hookFile = await optional(() => readFile(path.join(stage, hookConfig), 'utf8'));
  const hooks: unknown = object(manifest.hooks) ? manifest.hooks : JSON.parse(hookFile ?? '{}');
  async function checkHookCommands(value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const item of value) await checkHookCommands(item);
    } else if (object(value)) {
      if (typeof value.command === 'string') {
        const references =
          /(["'])\$\{PLUGIN_ROOT\}\/([^"']+)\1|\$\{PLUGIN_ROOT\}\/([^"'\s;&|<>]+)/g;
        for (const match of value.command.matchAll(references)) {
          const resource = match[2] ?? match[3]!;
          if (/[$*?[`]/.test(resource)) continue;
          const target = path.resolve(stage, resource);
          if (!inside(stage, target) || !(await optional(() => lstat(target))))
            throw new Error('Local package excludes a hook command resource: ' + resource);
        }
      }
      for (const child of Object.values(value)) await checkHookCommands(child);
    }
  }
  await checkHookCommands(hooks);
}

export async function localCacheEntries(
  cachePath: string,
  expected: EntryMap,
): Promise<EntryMap | null> {
  const stat = await optional(() => lstat(cachePath));
  if (!stat) return null;
  if (!stat.isDirectory() || (await realpath(cachePath)) !== cachePath)
    throw new Error('Installed local payload must be a real cache directory.');
  return readTree(cachePath, null, new Set(), 'cache', expected);
}

export async function checkLocalCacheParents(codexHome: string, cachePath: string): Promise<void> {
  let current = codexHome;
  for (const part of path.relative(codexHome, cachePath).split(path.sep)) {
    current = path.join(current, part);
    const stat = await optional(() => lstat(current));
    if (stat && !stat.isDirectory())
      throw new Error('Native cache parent must be a real directory: ' + current);
  }
}
