import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';

import { asError, hasErrorCode } from '../utils/errors.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';
import { InstallPaths } from './install-paths.ts';
import { selection } from '../utils/selection.ts';
import parseToml from '../utils/parse-toml.ts';

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
  paths: InstallPaths;
  catalogTarget: string;
  physicalRoot: string;
  physicalCodexHome: string;
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
  packageSnapshot: FileSnapshot | null;
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

/** validates the source identity and contained plugin resources used during installation. */
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
  const paths = new InstallPaths();
  const home = path.resolve(env.HOME ?? homedir());
  await paths.resolve(home, 'directory');
  const codexHome = path.resolve(options.codexHome ?? env.CODEX_HOME ?? path.join(home, '.codex'));
  const physicalCodexHome = await paths.resolve(codexHome, 'directory');
  const codexHomeStats = await optional(() => stat(codexHome));
  const configFile = path.join(codexHome, 'config.toml');
  const configSnapshot = await snapshot(configFile);
  const configValue = parseToml(configSnapshot?.text ?? '');
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
  const physicalRoot = await paths.resolve(root, 'directory');
  const catalogFile = path.join(root, '.agents/plugins/marketplace.json');
  const catalogTarget = await paths.resolve(catalogFile, 'file');
  const catalogSnapshot = await snapshot(catalogTarget);
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
    (!localMarketplace(configured) || (await realpath(configured.source)) !== physicalRoot)
  ) {
    throw new Error('Marketplace name/source collision: ' + catalog.name);
  }
  if (localMarketplace(configured)) await paths.resolve(configured.source, 'directory');
  for (const [name, value] of Object.entries(marketplaces)) {
    if (name === catalog.name || !localMarketplace(value)) continue;
    if (
      (await optional(() => realpath(value.source))) === physicalRoot ||
      (await optional(() =>
        realpath(path.join(value.source, '.agents/plugins/marketplace.json')),
      )) === catalogTarget
    )
      throw new Error('Marketplace source is configured under another name: ' + name);
  }
  await paths.unchanged();
  return {
    paths,
    catalogTarget,
    physicalRoot,
    physicalCodexHome,
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
  await context.paths.resolve(source.root, 'directory');
  const packageSnapshot = await snapshot(path.join(source.root, 'package.json'));
  const payload = await installationPayload(source, packageSnapshot);
  const catalogOverlaps = [catalogFile, context.catalogTarget].some((target) =>
    payload.some((selected) => inside(selected, target) || inside(target, selected)),
  );
  if (
    inside(source.root, codexHome) ||
    inside(source.root, context.physicalCodexHome) ||
    inside(context.physicalCodexHome, source.root)
  ) {
    throw new Error(
      'Plugin source overlaps the selected Codex home. Native Codex does not use ' +
        'codexTools.managedPaths to exclude installation state from local source copies.',
    );
  }
  if (catalogOverlaps) {
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
      packageSnapshot,
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
  const mappingParent = await context.paths.resolve(path.dirname(mapping), 'directory');
  const physicalMapping = path.join(mappingParent, path.basename(mapping));
  for (const candidate of localSources) {
    if (candidate.name === source.manifest.name) continue;
    const parent = await context.paths.resolve(path.dirname(candidate.path), 'directory');
    if (path.join(parent, path.basename(candidate.path)) === physicalMapping)
      throw new Error('Source mapping is already cataloged under another plugin name.');
  }
  if (
    mapping !== source.root &&
    physicalMapping !== source.root &&
    payload.some(
      (selected) =>
        inside(selected, mapping) ||
        inside(selected, physicalMapping) ||
        inside(mapping, selected) ||
        inside(physicalMapping, selected),
    )
  ) {
    throw new Error('Source mapping would be inside the plugin source payload.');
  }
  const mappingStats: Stats | null = await optional(() => lstat(mapping));
  const mappedSource = await optional(() => realpath(mapping));
  if (mappingStats && mappedSource !== source.root) {
    throw new Error('Refusing to replace existing source mapping: ' + mapping);
  }
  if (mappingStats) await context.paths.resolve(mapping, 'directory');
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
    packageSnapshot,
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
      const stats = await optional(() => stat(current));
      if (stats && !stats.isDirectory()) {
        throw new Error('Marketplace parent must resolve to a directory: ' + current);
      }
      if (!stats && !directories.includes(current)) directories.push(current);
    }
  }
  return directories;
}

async function installationPayload(
  source: ValidatedSource,
  packageFile: FileSnapshot | null,
): Promise<string[]> {
  const pkg: unknown = JSON.parse(packageFile?.text ?? '{}');
  if (!object(pkg) || (pkg.codexTools !== undefined && !object(pkg.codexTools)))
    throw new Error('Invalid package.json codexTools configuration.');
  const declared = object(pkg.codexTools) ? pkg.codexTools : {};
  const { managedPaths } = selection({
    managedPaths: (declared.managedPaths ?? null) as readonly string[] | null,
    excludeNames: (declared.excludeNames ?? []) as readonly string[],
  });
  if (!managedPaths) return [source.root];
  const selected = new Set([
    source.file,
    path.join(source.root, '.codex-plugin'),
    ...managedPaths.map((part) => path.join(source.root, part)),
  ]);
  for (const key of ['skills', 'apps', 'mcpServers', 'hooks']) {
    const value = source.manifest[key];
    if (typeof value === 'string' && value.startsWith('./'))
      selected.add(path.resolve(source.root, value));
  }
  const interfaceValue = object(source.manifest.interface) ? source.manifest.interface : {};
  for (const value of [
    interfaceValue.composerIcon,
    interfaceValue.logo,
    ...(Array.isArray(interfaceValue.screenshots) ? interfaceValue.screenshots : []),
  ]) {
    if (typeof value === 'string' && value.startsWith('./'))
      selected.add(path.resolve(source.root, value));
  }
  for (const target of [...selected]) {
    const physical = await optional(() => realpath(target));
    if (physical) selected.add(physical);
  }
  return [...selected];
}
