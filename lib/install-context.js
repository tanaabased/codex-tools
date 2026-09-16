import { TOML } from 'bun';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value);
const marketName = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
export const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
export async function optional(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function snapshot(file) {
  const stats = await optional(() => lstat(file));
  if (!stats) return null;
  if (!stats.isFile() || stats.nlink !== 1)
    throw new Error('Expected an unlinked regular file: ' + file);
  return {
    text: await readFile(file, 'utf8'),
    ino: stats.ino,
    dev: stats.dev,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
  };
}

export async function validateSource(sourcePath, { portable = false } = {}) {
  let root = path.resolve(sourcePath);
  try {
    root = await realpath(root);
    let file = path.join(root, '.codex-plugin/plugin.json');
    let original = await snapshot(file);
    let portableManifest = false;
    if (portable) {
      const candidate = await snapshot(path.join(root, 'plugin.json'));
      if (candidate) {
        const data = JSON.parse(candidate.text);
        if (
          typeof data?.$schema === 'string' &&
          data.$schema.startsWith('https://agent-plugins.org/schemas/')
        ) {
          file = path.join(root, 'plugin.json');
          original = candidate;
          portableManifest = true;
        }
      }
    }
    const manifest = JSON.parse(original?.text ?? 'null');
    if (
      !object(manifest) ||
      !identifier(manifest.name) ||
      manifest.name.length > 100 ||
      (manifest.version !== undefined &&
        (typeof manifest.version !== 'string' ||
          !manifest.version ||
          ['.', '..'].includes(manifest.version) ||
          /[/\\]/.test(manifest.version) ||
          [...manifest.version].some((char) => char.charCodeAt(0) < 32)))
    )
      throw new Error('Invalid plugin name or version in .codex-plugin/plugin.json.');
    let resources = manifest;
    if (portableManifest) {
      const overlay = manifest.extensions?.['com.openai'];
      resources = object(overlay)
        ? overlay
        : JSON.parse((await snapshot(path.join(root, '.codex-plugin/plugin.json')))?.text ?? '{}');
      resources = { ...resources, skills: undefined, mcpServers: undefined };
      if (await optional(() => lstat(path.join(root, 'skills')))) resources.skills = './skills';
      if (await optional(() => lstat(path.join(root, 'mcp.json'))))
        resources.mcpServers = './mcp.json';
    }
    for (const [key, directory] of [
      ['skills', true],
      ['apps', false],
      ['mcpServers', false],
      ...(portable ? [['hooks', false]] : []),
    ]) {
      const value = resources[key];
      if (value === undefined || (!directory && object(value))) continue;
      if (typeof value !== 'string' || !value.startsWith('./'))
        throw new Error('Unsupported plugin resource: ' + key);
      const target = path.resolve(root, value);
      if (!inside(root, target) || !inside(root, await realpath(target)))
        throw new Error('Plugin resource escapes source: ' + key);
      const stats = await stat(target);
      if (directory ? !stats.isDirectory() : !stats.isFile())
        throw new Error('Wrong plugin resource type: ' + key);
      if (!directory && !object(JSON.parse(await readFile(target, 'utf8'))))
        throw new Error('Invalid plugin resource JSON: ' + key);
    }
    if (portable) {
      const assets = ['composerIcon', 'logo'].map((key) => resources.interface?.[key]);
      if (Array.isArray(resources.interface?.screenshots))
        assets.push(...resources.interface.screenshots);
      for (const resource of assets.filter(
        (value) => typeof value === 'string' && value.startsWith('./'),
      )) {
        const target = path.resolve(root, resource);
        if (
          !inside(root, target) ||
          !inside(root, await realpath(target)) ||
          !(await stat(target)).isFile()
        )
          throw new Error('Missing or uncontained plugin asset.');
      }
    }
    return { root, file, original, manifest };
  } catch (error) {
    error.source = { path: root, valid: false, issue: error.message };
    throw error;
  }
}

export async function resolveMarketplace(options, env) {
  for (const key of [
    'cachePathOverride',
    'missingTarget',
    'absentCheck',
    'managedPaths',
    'excludeNames',
  ]) {
    if (options[key] !== undefined) throw new Error(key + ' is not an install option.');
  }
  const home = await realpath(env.HOME ?? homedir());
  const codexHome = path.resolve(options.codexHome ?? env.CODEX_HOME ?? path.join(home, '.codex'));
  const codexHomeStats = await optional(() => lstat(codexHome));
  if (codexHomeStats && !codexHomeStats.isDirectory())
    throw new Error('Selected Codex home must be a real directory.');
  const configFile = path.join(codexHome, 'config.toml');
  const configSnapshot = await snapshot(configFile);
  const config = TOML.parse(configSnapshot?.text ?? '');
  if (config.marketplaces !== undefined && !object(config.marketplaces))
    throw new Error('Invalid marketplaces configuration.');
  const selected = options.marketplace;
  if (selected !== undefined && !marketName(selected)) throw new Error('Invalid marketplace name.');
  let root = home;
  if (options.marketplacePath) {
    const catalog = path.resolve(options.marketplacePath);
    if (!catalog.endsWith(path.sep + path.join('.agents', 'plugins', 'marketplace.json')))
      throw new Error('--marketplace-path must end in .agents/plugins/marketplace.json.');
    root = path.resolve(catalog, '../../..');
  } else if (selected && config.marketplaces?.[selected]) {
    const configured = config.marketplaces[selected];
    if (
      configured.source_type !== 'local' ||
      typeof configured.source !== 'string' ||
      !path.isAbsolute(configured.source)
    )
      throw new Error('Select a local marketplace with --marketplace-path.');
    root = configured.source;
  }
  root = await realpath(root);
  const catalogFile = path.join(root, '.agents/plugins/marketplace.json');
  const catalogSnapshot = await snapshot(catalogFile);
  const catalog = catalogSnapshot
    ? JSON.parse(catalogSnapshot.text)
    : {
        name: selected ?? 'personal',
        interface: { displayName: selected ?? 'Personal' },
        plugins: [],
      };
  if (object(catalog) && catalog.plugins === undefined) catalog.plugins = [];
  if (
    !object(catalog) ||
    !marketName(catalog.name) ||
    !Array.isArray(catalog.plugins) ||
    (catalog.interface !== undefined && !object(catalog.interface))
  )
    throw new Error('Malformed marketplace catalog: ' + catalogFile);
  if (selected && selected !== catalog.name)
    throw new Error('Selected marketplace name does not match catalog.');
  const configured = config.marketplaces?.[catalog.name];
  if (
    configured &&
    (configured.source_type !== 'local' ||
      typeof configured.source !== 'string' ||
      !path.isAbsolute(configured.source) ||
      (await realpath(configured.source)) !== root)
  )
    throw new Error('Marketplace name/source collision: ' + catalog.name);
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
    register: root !== home && !configured,
  };
}

export async function resolveInstall(options, env, preparedSource) {
  const source = preparedSource ?? (await validateSource(options.repoRoot ?? process.cwd()));
  const context = await resolveMarketplace(options, env);
  const { root, codexHome, catalog, catalogFile } = context;
  if (inside(source.root, catalogFile) || inside(source.root, codexHome))
    throw new Error('Plugin source overlaps installation state or marketplace catalog.');
  const npm = source.npm;
  const names = new Set();
  const localSources = [];
  let entry;
  for (const candidate of catalog.plugins) {
    if (
      !object(candidate) ||
      !identifier(candidate.name) ||
      names.has(candidate.name) ||
      !object(candidate.source) ||
      !['local', 'git', 'npm'].includes(candidate.source.source) ||
      (candidate.policy !== undefined &&
        (!object(candidate.policy) ||
          (candidate.policy.installation !== undefined &&
            !['AVAILABLE', 'NOT_AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(
              candidate.policy.installation,
            )) ||
          (candidate.policy.authentication !== undefined &&
            !['ON_INSTALL', 'ON_USE'].includes(candidate.policy.authentication))))
    )
      throw new Error('Malformed or duplicate marketplace entry.');
    names.add(candidate.name);
    if (candidate.name === source.manifest.name) entry = candidate;
    if (candidate.source.source === 'local') {
      if (
        typeof candidate.source.path !== 'string' ||
        !candidate.source.path.startsWith('./') ||
        !inside(root, path.resolve(root, candidate.source.path))
      )
        throw new Error('Invalid local marketplace source path.');
      const resolved = await optional(() => realpath(path.resolve(root, candidate.source.path)));
      localSources.push({ name: candidate.name, path: path.resolve(root, candidate.source.path) });
      if (resolved === source.root && candidate.name !== source.manifest.name)
        throw new Error('Source is already cataloged under another plugin name: ' + candidate.name);
    }
  }
  if (
    entry &&
    (entry.source.source !== (npm ? 'npm' : 'local') ||
      (npm && (entry.source.package !== npm.package || entry.source.registry !== npm.registry)))
  )
    throw new Error('Plugin name/source collision: ' + entry.name);
  if (entry?.policy?.installation === 'NOT_AVAILABLE')
    throw new Error('Marketplace policy does not allow installation.');
  if (npm) {
    for (const candidate of catalog.plugins) {
      if (
        candidate.source.source === 'npm' &&
        candidate.source.package === npm.package &&
        candidate.source.registry === npm.registry &&
        candidate.name !== source.manifest.name
      )
        throw new Error('Package is already cataloged under another plugin identity.');
    }
    const next = {
      ...entry?.source,
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
    const editCatalog =
      !entry ||
      !isDeepStrictEqual(entry.source, next) ||
      !isDeepStrictEqual(entry.codexTools?.npm, metadata);
    if (!entry) {
      entry = {
        name: source.manifest.name,
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      };
      catalog.plugins.push(entry);
    }
    if (entry.codexTools !== undefined && !object(entry.codexTools))
      throw new Error('Malformed Codex Tools marketplace metadata.');
    entry.source = next;
    entry.codexTools = { ...entry.codexTools, npm: metadata };
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
  const mapping = path.resolve(root, entry?.source.path ?? './plugins/' + source.manifest.name);
  if (
    localSources.some(
      (candidate) => candidate.name !== source.manifest.name && candidate.path === mapping,
    )
  )
    throw new Error('Source mapping is already cataloged under another plugin name.');
  if (inside(source.root, mapping) && mapping !== source.root)
    throw new Error('Source mapping would be inside the plugin source.');
  const mappingStats = await optional(() => lstat(mapping));
  const mappedSource = await optional(() => realpath(mapping));
  if (mappingStats && mappedSource !== source.root)
    throw new Error('Refusing to replace existing source mapping: ' + mapping);
  const directories = await marketplaceDirectories(root, [
    path.dirname(mapping),
    path.dirname(catalogFile),
  ]);
  if (!entry)
    catalog.plugins.push({
      name: source.manifest.name,
      source: {
        source: 'local',
        path: './' + path.relative(root, mapping).split(path.sep).join('/'),
      },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    });
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

async function marketplaceDirectories(root, targets) {
  const directories = [];
  for (const target of targets) {
    let current = root;
    for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stats = await optional(() => lstat(current));
      if (stats && !stats.isDirectory())
        throw new Error('Marketplace parent must be a real directory: ' + current);
      if (!stats && !directories.includes(current)) directories.push(current);
    }
  }
  return directories;
}
