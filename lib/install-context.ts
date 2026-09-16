import { TOML } from 'bun';
import type { Stats } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { asError, hasErrorCode } from '../utils/errors.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';

export type UnknownRecord = Record<string, unknown>;

export interface FileSnapshot {
  text: string;
  ino: number;
  dev: number;
  mode: number;
  mtimeMs: number;
}

export interface PluginManifest extends UnknownRecord {
  name: string;
  version?: string;
}

export interface NpmProvenance {
  requested: string;
  package: string;
  version: string;
  registry: string;
}

export interface ValidatedSource {
  root: string;
  file: string;
  original: FileSnapshot | null;
  manifest: PluginManifest;
  npm?: NpmProvenance;
  nativeVersion?: string;
}

export interface MarketplaceSource extends UnknownRecord {
  source: 'local' | 'git' | 'npm';
  path?: string;
  package?: string;
  version?: string;
  registry?: string;
}

export interface MarketplacePolicy extends UnknownRecord {
  installation?: 'AVAILABLE' | 'NOT_AVAILABLE' | 'INSTALLED_BY_DEFAULT';
  authentication?: 'ON_INSTALL' | 'ON_USE';
}

export interface MarketplaceEntry extends UnknownRecord {
  name: string;
  source: MarketplaceSource;
  policy?: MarketplacePolicy;
  codexTools?: UnknownRecord;
}

export interface MarketplaceCatalog extends UnknownRecord {
  name: string;
  interface?: UnknownRecord;
  plugins: MarketplaceEntry[];
}

export interface MarketplaceContext {
  home: string;
  codexHome: string;
  createCodexHome: boolean;
  configFile: string;
  configSnapshot: FileSnapshot | null;
  root: string;
  catalogFile: string;
  catalogSnapshot: FileSnapshot | null;
  catalog: MarketplaceCatalog;
  register: boolean;
}

export interface InstallContext extends MarketplaceContext {
  source: ValidatedSource;
  mapping: string | null;
  mappingStats: { ino: number; dev: number } | null;
  directories: string[];
  addMapping: boolean;
  editCatalog: boolean;
}

export function object(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value);
}

function marketName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function localMarketplace(value: unknown): value is UnknownRecord & {
  source_type: 'local';
  source: string;
} {
  return (
    object(value) &&
    value.source_type === 'local' &&
    typeof value.source === 'string' &&
    path.isAbsolute(value.source)
  );
}

function marketplaceEntry(value: unknown): value is MarketplaceEntry {
  if (!object(value) || !identifier(value.name) || !object(value.source)) return false;
  if (
    value.source.source !== 'local' &&
    value.source.source !== 'git' &&
    value.source.source !== 'npm'
  ) {
    return false;
  }
  if (value.policy !== undefined) {
    if (!object(value.policy)) return false;
    if (
      value.policy.installation !== undefined &&
      value.policy.installation !== 'AVAILABLE' &&
      value.policy.installation !== 'NOT_AVAILABLE' &&
      value.policy.installation !== 'INSTALLED_BY_DEFAULT'
    ) {
      return false;
    }
    if (
      value.policy.authentication !== undefined &&
      value.policy.authentication !== 'ON_INSTALL' &&
      value.policy.authentication !== 'ON_USE'
    ) {
      return false;
    }
  }
  return true;
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

export async function snapshot(file: string): Promise<FileSnapshot | null> {
  const stats = await optional(() => lstat(file));
  if (!stats) return null;
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error('Expected an unlinked regular file: ' + file);
  }
  return {
    text: await readFile(file, 'utf8'),
    ino: stats.ino,
    dev: stats.dev,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
  };
}

/** Validates the source identity and contained plugin resources used during installation. */
export async function validateSource(
  sourcePath: string,
  { portable = false }: { portable?: boolean } = {},
): Promise<ValidatedSource> {
  let root = path.resolve(sourcePath);
  try {
    root = await realpath(root);
    let file = path.join(root, '.codex-plugin/plugin.json');
    let original = await snapshot(file);
    let portableManifest = false;
    if (portable) {
      const candidate = await snapshot(path.join(root, 'plugin.json'));
      if (candidate) {
        const data = JSON.parse(candidate.text) as unknown;
        if (
          object(data) &&
          typeof data.$schema === 'string' &&
          data.$schema.startsWith('https://agent-plugins.org/schemas/')
        ) {
          file = path.join(root, 'plugin.json');
          original = candidate;
          portableManifest = true;
        }
      }
    }
    const manifestValue = JSON.parse(original?.text ?? 'null') as unknown;
    if (
      !object(manifestValue) ||
      !identifier(manifestValue.name) ||
      manifestValue.name.length > 100 ||
      (manifestValue.version !== undefined &&
        (typeof manifestValue.version !== 'string' ||
          !manifestValue.version ||
          ['.', '..'].includes(manifestValue.version) ||
          /[/\\]/.test(manifestValue.version) ||
          [...manifestValue.version].some((char) => char.charCodeAt(0) < 32)))
    ) {
      throw new Error('Invalid plugin name or version in .codex-plugin/plugin.json.');
    }
    const manifest: PluginManifest = {
      ...manifestValue,
      name: manifestValue.name,
      ...(typeof manifestValue.version === 'string' ? { version: manifestValue.version } : {}),
    };
    let resources: UnknownRecord = manifest;
    if (portableManifest) {
      const extensions = object(manifest.extensions) ? manifest.extensions : {};
      const overlay = extensions['com.openai'];
      if (object(overlay)) {
        resources = { ...overlay };
      } else {
        const codexManifest = JSON.parse(
          (await snapshot(path.join(root, '.codex-plugin/plugin.json')))?.text ?? '{}',
        ) as unknown;
        resources = object(codexManifest) ? { ...codexManifest } : {};
      }
      delete resources.skills;
      delete resources.mcpServers;
      if (await optional(() => lstat(path.join(root, 'skills')))) resources.skills = './skills';
      if (await optional(() => lstat(path.join(root, 'mcp.json')))) {
        resources.mcpServers = './mcp.json';
      }
    }
    const resourceKinds: Array<[string, boolean]> = [
      ['skills', true],
      ['apps', false],
      ['mcpServers', false],
      ...(portable ? ([['hooks', false]] as Array<[string, boolean]>) : []),
    ];
    for (const [key, directory] of resourceKinds) {
      const value = resources[key];
      if (value === undefined || (!directory && object(value))) continue;
      if (typeof value !== 'string' || !value.startsWith('./')) {
        throw new Error('Unsupported plugin resource: ' + key);
      }
      const target = path.resolve(root, value);
      if (!inside(root, target) || !inside(root, await realpath(target))) {
        throw new Error('Plugin resource escapes source: ' + key);
      }
      const stats = await stat(target);
      if (directory ? !stats.isDirectory() : !stats.isFile()) {
        throw new Error('Wrong plugin resource type: ' + key);
      }
      if (!directory) {
        const data = JSON.parse(await readFile(target, 'utf8')) as unknown;
        if (!object(data)) throw new Error('Invalid plugin resource JSON: ' + key);
      }
    }
    if (portable) {
      const interfaceValue = object(resources.interface) ? resources.interface : {};
      const assets: unknown[] = [interfaceValue.composerIcon, interfaceValue.logo];
      if (Array.isArray(interfaceValue.screenshots)) assets.push(...interfaceValue.screenshots);
      for (const resource of assets) {
        if (typeof resource !== 'string' || !resource.startsWith('./')) continue;
        const target = path.resolve(root, resource);
        if (
          !inside(root, target) ||
          !inside(root, await realpath(target)) ||
          !(await stat(target)).isFile()
        ) {
          throw new Error('Missing or uncontained plugin asset.');
        }
      }
    }
    return { root, file, original, manifest };
  } catch (error) {
    const failure = asError(error);
    failure.source = { path: root, valid: false, issue: failure.message };
    throw failure;
  }
}

export async function resolveMarketplace(
  options: CodexToolsOptions,
  env: NodeJS.ProcessEnv,
): Promise<MarketplaceContext> {
  const unsupported: Array<keyof CodexToolsOptions> = [
    'cachePathOverride',
    'missingTarget',
    'absentCheck',
    'managedPaths',
    'excludeNames',
  ];
  for (const key of unsupported) {
    if (options[key] !== undefined) throw new Error(key + ' is not an install option.');
  }
  const home = await realpath(env.HOME ?? homedir());
  const codexHome = path.resolve(options.codexHome ?? env.CODEX_HOME ?? path.join(home, '.codex'));
  const codexHomeStats = await optional(() => lstat(codexHome));
  if (codexHomeStats && !codexHomeStats.isDirectory()) {
    throw new Error('Selected Codex home must be a real directory.');
  }
  const configFile = path.join(codexHome, 'config.toml');
  const configSnapshot = await snapshot(configFile);
  const configValue = TOML.parse(configSnapshot?.text ?? '') as unknown;
  if (!object(configValue)) throw new Error('Invalid marketplaces configuration.');
  const marketplaces = configValue.marketplaces ?? {};
  if (!object(marketplaces)) throw new Error('Invalid marketplaces configuration.');
  const selected = options.marketplace;
  if (selected !== undefined && !marketName(selected)) throw new Error('Invalid marketplace name.');
  let root = home;
  if (options.marketplacePath) {
    const catalogPath = path.resolve(options.marketplacePath);
    if (!catalogPath.endsWith(path.sep + path.join('.agents', 'plugins', 'marketplace.json'))) {
      throw new Error('--marketplace-path must end in .agents/plugins/marketplace.json.');
    }
    root = path.resolve(catalogPath, '../../..');
  } else if (selected && marketplaces[selected] !== undefined) {
    const configured = marketplaces[selected];
    if (!localMarketplace(configured)) {
      throw new Error('Select a local marketplace with --marketplace-path.');
    }
    root = configured.source;
  }
  root = await realpath(root);
  const catalogFile = path.join(root, '.agents/plugins/marketplace.json');
  const catalogSnapshot = await snapshot(catalogFile);
  const catalogValue: unknown = catalogSnapshot
    ? (JSON.parse(catalogSnapshot.text) as unknown)
    : {
        name: selected ?? 'personal',
        interface: { displayName: selected ?? 'Personal' },
        plugins: [],
      };
  if (object(catalogValue) && catalogValue.plugins === undefined) catalogValue.plugins = [];
  if (
    !object(catalogValue) ||
    !marketName(catalogValue.name) ||
    !Array.isArray(catalogValue.plugins) ||
    !catalogValue.plugins.every(marketplaceEntry) ||
    (catalogValue.interface !== undefined && !object(catalogValue.interface))
  ) {
    throw new Error('Malformed marketplace catalog: ' + catalogFile);
  }
  const catalog: MarketplaceCatalog = {
    ...catalogValue,
    name: catalogValue.name,
    plugins: catalogValue.plugins,
  };
  if (selected && selected !== catalog.name) {
    throw new Error('Selected marketplace name does not match catalog.');
  }
  const configured = marketplaces[catalog.name];
  if (
    configured !== undefined &&
    (!localMarketplace(configured) || (await realpath(configured.source)) !== root)
  ) {
    throw new Error('Marketplace name/source collision: ' + catalog.name);
  }
  return {
    home,
    codexHome,
    createCodexHome: !codexHomeStats,
    configFile,
    configSnapshot,
    root,
    catalogFile,
    catalogSnapshot,
    catalog,
    register: root !== home && configured === undefined,
  };
}

export async function resolveInstall(
  options: CodexToolsOptions,
  env: NodeJS.ProcessEnv,
  preparedSource?: ValidatedSource,
): Promise<InstallContext> {
  const source = preparedSource ?? (await validateSource(options.repoRoot ?? process.cwd()));
  const context = await resolveMarketplace(options, env);
  const { root, codexHome, catalog, catalogFile } = context;
  if (inside(source.root, catalogFile) || inside(source.root, codexHome)) {
    throw new Error('Plugin source overlaps installation state or marketplace catalog.');
  }
  const npm = source.npm;
  const names = new Set<string>();
  const localSources: Array<{ name: string; path: string }> = [];
  let entry: MarketplaceEntry | undefined;
  for (const candidate of catalog.plugins) {
    if (names.has(candidate.name)) throw new Error('Malformed or duplicate marketplace entry.');
    names.add(candidate.name);
    if (candidate.name === source.manifest.name) entry = candidate;
    if (candidate.source.source === 'local') {
      if (
        typeof candidate.source.path !== 'string' ||
        !candidate.source.path.startsWith('./') ||
        !inside(root, path.resolve(root, candidate.source.path))
      ) {
        throw new Error('Invalid local marketplace source path.');
      }
      const candidatePath = path.resolve(root, candidate.source.path);
      const resolved = await optional(() => realpath(candidatePath));
      localSources.push({ name: candidate.name, path: candidatePath });
      if (resolved === source.root && candidate.name !== source.manifest.name) {
        throw new Error('Source is already cataloged under another plugin name: ' + candidate.name);
      }
    }
  }
  if (
    entry &&
    (entry.source.source !== (npm ? 'npm' : 'local') ||
      (npm && (entry.source.package !== npm.package || entry.source.registry !== npm.registry)))
  ) {
    throw new Error('Plugin name/source collision: ' + entry.name);
  }
  if (entry?.policy?.installation === 'NOT_AVAILABLE') {
    throw new Error('Marketplace policy does not allow installation.');
  }
  if (npm) {
    for (const candidate of catalog.plugins) {
      if (
        candidate.source.source === 'npm' &&
        candidate.source.package === npm.package &&
        candidate.source.registry === npm.registry &&
        candidate.name !== source.manifest.name
      ) {
        throw new Error('Package is already cataloged under another plugin identity.');
      }
    }
    const next: MarketplaceSource = {
      ...(entry?.source ?? {}),
      source: 'npm',
      package: npm.package,
      version: npm.version,
      registry: npm.registry,
    };
    const metadata = {
      requested: npm.requested,
      package: npm.package,
      version: npm.version,
      registry: npm.registry,
      pluginName: source.manifest.name,
      pluginVersion: source.manifest.version ?? null,
    };
    const existingMetadata = object(entry?.codexTools) ? entry.codexTools.npm : undefined;
    const editCatalog =
      !entry ||
      !isDeepStrictEqual(entry.source, next) ||
      !isDeepStrictEqual(existingMetadata, metadata);
    if (!entry) {
      entry = {
        name: source.manifest.name,
        source: next,
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      };
      catalog.plugins.push(entry);
    }
    if (entry.codexTools !== undefined && !object(entry.codexTools)) {
      throw new Error('Malformed Codex Tools marketplace metadata.');
    }
    entry.source = next;
    entry.codexTools = { ...(entry.codexTools ?? {}), npm: metadata };
    const directories = await marketplaceDirectories(root, [path.dirname(catalogFile)]);
    return {
      ...context,
      source,
      mapping: null,
      mappingStats: null,
      directories,
      addMapping: false,
      editCatalog,
    };
  }
  const entryPath =
    entry?.source.source === 'local' && typeof entry.source.path === 'string'
      ? entry.source.path
      : './plugins/' + source.manifest.name;
  const mapping = path.resolve(root, entryPath);
  if (
    localSources.some(
      (candidate) => candidate.name !== source.manifest.name && candidate.path === mapping,
    )
  ) {
    throw new Error('Source mapping is already cataloged under another plugin name.');
  }
  if (inside(source.root, mapping) && mapping !== source.root) {
    throw new Error('Source mapping would be inside the plugin source.');
  }
  const mappingStats: Stats | null = await optional(() => lstat(mapping));
  const mappedSource = await optional(() => realpath(mapping));
  if (mappingStats && mappedSource !== source.root) {
    throw new Error('Refusing to replace existing source mapping: ' + mapping);
  }
  const directories = await marketplaceDirectories(root, [
    path.dirname(mapping),
    path.dirname(catalogFile),
  ]);
  if (!entry) {
    catalog.plugins.push({
      name: source.manifest.name,
      source: {
        source: 'local',
        path: './' + path.relative(root, mapping).split(path.sep).join('/'),
      },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    });
  }
  return {
    source,
    ...context,
    mapping,
    mappingStats: mappingStats ? { ino: mappingStats.ino, dev: mappingStats.dev } : null,
    directories,
    addMapping: !mappingStats,
    editCatalog: !entry,
  };
}

async function marketplaceDirectories(root: string, targets: readonly string[]): Promise<string[]> {
  const directories: string[] = [];
  for (const target of targets) {
    let current = root;
    for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stats = await optional(() => lstat(current));
      if (stats && !stats.isDirectory()) {
        throw new Error('Marketplace parent must be a real directory: ' + current);
      }
      if (!stats && !directories.includes(current)) directories.push(current);
    }
  }
  return directories;
}
