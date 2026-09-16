import { TOML } from 'bun';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { selection } from '../utils/selection.js';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const segment = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function directories(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function inspectInstallation(cachePath, identity) {
  const result = {
    cachePath,
    cachePresent: false,
    name: null,
    version: null,
    compatible: false,
    issue: 'cache path is missing',
  };
  let stats;
  try {
    stats = await lstat(cachePath);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  result.cachePresent = true;
  if (!stats.isDirectory()) return { ...result, issue: 'cache path is not a directory' };
  let manifest;
  try {
    manifest = await json(path.join(cachePath, '.codex-plugin/plugin.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return { ...result, issue: 'cached plugin manifest is missing' };
    if (error instanceof SyntaxError)
      return { ...result, issue: 'cached plugin manifest is invalid JSON' };
    throw error;
  }
  result.name = manifest?.name ?? null;
  result.version = manifest?.version ?? null;
  result.issue =
    result.name !== identity.name
      ? 'cached plugin name does not match source'
      : result.version !== identity.version
        ? 'cached plugin version does not match source'
        : null;
  result.compatible = result.issue === null;
  return result;
}

export async function resolveContext(options = {}) {
  let repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  let packageJson;
  let pluginJson;
  try {
    repoRoot = await realpath(repoRoot);
    packageJson = await json(path.join(repoRoot, 'package.json'));
    pluginJson = await json(path.join(repoRoot, '.codex-plugin/plugin.json'));
    if (
      !object(packageJson) ||
      typeof packageJson.version !== 'string' ||
      !packageJson.version ||
      !object(pluginJson) ||
      !segment(pluginJson.name) ||
      (pluginJson.version !== undefined &&
        (typeof pluginJson.version !== 'string' || !pluginJson.version))
    ) {
      throw new Error('Source package/plugin identity is invalid.');
    }
  } catch (error) {
    error.source = { path: repoRoot, valid: false, issue: error.message };
    throw error;
  }
  const declared = packageJson.codexTools ?? {};
  const known = ['managedPaths', 'excludeNames', 'marketplace', 'missingTarget', 'absentCheck'];
  if (!object(declared) || Object.keys(declared).some((key) => !known.includes(key)))
    throw new Error('Invalid package.json codexTools configuration.');
  const config = {
    managedPaths: null,
    excludeNames: [],
    missingTarget: 'require-installed',
    absentCheck: 'fail',
    ...declared,
  };
  for (const key of known) if (options[key] !== undefined) config[key] = options[key];
  selection(config);
  if (
    !['require-installed', 'create'].includes(config.missingTarget) ||
    !['fail', 'neutral'].includes(config.absentCheck)
  ) {
    throw new Error('Invalid cache compatibility setting.');
  }
  const identity = {
    name: pluginJson.name,
    version: pluginJson.version ?? packageJson.version,
    packageVersion: packageJson.version,
  };
  const rawHome = path.resolve(
    options.codexHome ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex'),
  );
  let codexHome = rawHome;
  try {
    codexHome = await realpath(rawHome);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const cacheRoot = path.join(codexHome, 'plugins/cache');
  let marketplace = options.marketplace ?? config.marketplace ?? null;
  if (marketplace !== null && !segment(marketplace)) throw new Error('Invalid marketplace name.');
  let codexConfig = {};
  let configObserved = false;
  try {
    codexConfig = TOML.parse(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
    configObserved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const candidates = [];
  for (const market of marketplace ? [marketplace] : await directories(cacheRoot)) {
    for (const directory of await directories(path.join(cacheRoot, market, identity.name))) {
      const candidate = await inspectInstallation(
        path.join(cacheRoot, market, identity.name, directory),
        identity,
      );
      candidates.push({ ...candidate, marketplace: market, directory });
    }
  }
  const matching = candidates.filter((candidate) => candidate.compatible);
  let cachePath = options.cachePathOverride ? path.resolve(options.cachePathOverride) : null;
  if (cachePath && rawHome !== codexHome) {
    const relative = path.relative(rawHome, cachePath);
    if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
      // Normalize only the selected home alias; cache-tree links must still fail verification.
      cachePath = path.join(codexHome, relative);
    }
  }
  let resolutionIssue = null;
  if (!cachePath) {
    if (matching.length === 1) {
      cachePath = matching[0].cachePath;
      marketplace = matching[0].marketplace;
    } else
      resolutionIssue =
        matching.length > 1
          ? 'ambiguous exact-version caches; select --marketplace and/or --cache-path'
          : 'no exact-version cache found; install through Codex or select an explicit raw target';
  }
  let inspection = cachePath
    ? await inspectInstallation(cachePath, identity)
    : {
        cachePath: null,
        cachePresent: false,
        name: null,
        version: null,
        compatible: false,
        issue: resolutionIssue,
      };
  let layoutVerified = false;
  if (cachePath) {
    if (inspection.cachePresent && inspection.issue === 'cache path is not a directory')
      resolutionIssue = inspection.issue;
    const relative = path.relative(cacheRoot, cachePath).split(path.sep);
    if (relative.length === 3 && relative.every(segment) && relative[1] === identity.name) {
      if (marketplace && marketplace !== relative[0])
        resolutionIssue = 'cache path does not match selected marketplace';
      else {
        marketplace = relative[0];
        layoutVerified = true;
      }
      // Do not classify an alias outside the selected Codex home as an installation.
      if (inspection.cachePresent) {
        layoutVerified = layoutVerified && (await realpath(cachePath)) === cachePath;
      }
    }
  }
  const key = marketplace ? identity.name + '@' + marketplace : null;
  const configured = key ? codexConfig.plugins?.[key] : undefined;
  if (
    configured !== undefined &&
    (!object(configured) ||
      (configured.enabled !== undefined && typeof configured.enabled !== 'boolean'))
  ) {
    throw new Error('Unsupported plugin configuration for selected installation.');
  }
  const registered = key && configObserved ? configured !== undefined : null;
  const enabled = configured?.enabled ?? null;
  inspection = {
    ...inspection,
    installed: Boolean(
      config.missingTarget !== 'create' &&
      layoutVerified &&
      inspection?.compatible &&
      !resolutionIssue,
    ),
    layoutVerified,
    registered,
    enabled,
  };
  return {
    repoRoot,
    codexHome,
    cachePath,
    marketplace,
    identity,
    config,
    inspection,
    candidates,
    resolutionIssue,
  };
}
