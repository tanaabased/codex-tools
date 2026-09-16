import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { asError, hasErrorCode } from '../utils/errors.ts';
import parseToml from '../utils/parse-toml.ts';
import type { AbsentCheck, CodexToolsOptions, MissingTarget } from '../utils/parse-args.ts';
import { selection } from '../utils/selection.ts';

type UnknownRecord = Record<string, unknown>;

export interface PluginIdentity {
  name: string;
  version: string;
  packageVersion: string;
}

export interface CacheConfiguration {
  managedPaths: readonly string[] | null;
  excludeNames: readonly string[];
  marketplace: string | null;
  missingTarget: MissingTarget;
  absentCheck: AbsentCheck;
}

export interface InstallationInspection {
  cachePath: string | null;
  cachePresent: boolean;
  name: string | null;
  version: string | null;
  compatible: boolean;
  issue: string | null;
  installed: boolean;
  layoutVerified: boolean;
  registered: boolean | null;
  enabled: boolean | null;
}

export interface InstallationCandidate extends Omit<
  InstallationInspection,
  'installed' | 'layoutVerified' | 'registered' | 'enabled'
> {
  marketplace: string;
  directory: string;
}

export interface ResolvedContext {
  repoRoot: string;
  codexHome: string;
  cachePath: string | null;
  marketplace: string | null;
  identity: PluginIdentity;
  config: CacheConfiguration;
  inspection: InstallationInspection;
  candidates: InstallationCandidate[];
  resolutionIssue: string | null;
}

function object(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function segment(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(value);
}

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function directories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
}

function stringList(value: unknown, fallback: readonly string[]): readonly string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid package.json codexTools configuration.');
  }
  return value;
}

function managedList(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return null;
  return stringList(value, []);
}

function missingTarget(value: unknown): MissingTarget {
  if (value === undefined) return 'require-installed';
  if (value !== 'require-installed' && value !== 'create') {
    throw new Error('Invalid cache compatibility setting.');
  }
  return value;
}

function absentCheck(value: unknown): AbsentCheck {
  if (value === undefined) return 'fail';
  if (value !== 'fail' && value !== 'neutral') {
    throw new Error('Invalid cache compatibility setting.');
  }
  return value;
}

function marketplaceName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!segment(value)) throw new Error('Invalid marketplace name.');
  return value;
}

/** Inspects one selected cache directory without inferring installation or activation state. */
export async function inspectInstallation(
  cachePath: string,
  identity: Pick<PluginIdentity, 'name' | 'version'>,
): Promise<
  Omit<InstallationInspection, 'installed' | 'layoutVerified' | 'registered' | 'enabled'>
> {
  const result: Omit<
    InstallationInspection,
    'installed' | 'layoutVerified' | 'registered' | 'enabled'
  > = {
    cachePath,
    cachePresent: false,
    name: null,
    version: null,
    compatible: false,
    issue: 'cache path is missing',
  };
  try {
    const stats = await lstat(cachePath);
    result.cachePresent = true;
    if (!stats.isDirectory()) return { ...result, issue: 'cache path is not a directory' };
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return result;
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = await json(path.join(cachePath, '.codex-plugin/plugin.json'));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { ...result, issue: 'cached plugin manifest is missing' };
    }
    if (error instanceof SyntaxError) {
      return { ...result, issue: 'cached plugin manifest is invalid JSON' };
    }
    throw error;
  }
  if (object(manifest)) {
    result.name = typeof manifest.name === 'string' ? manifest.name : null;
    result.version = typeof manifest.version === 'string' ? manifest.version : null;
  }
  result.issue =
    result.name !== identity.name
      ? 'cached plugin name does not match source'
      : result.version !== identity.version
        ? 'cached plugin version does not match source'
        : null;
  result.compatible = result.issue === null;
  return result;
}

/** Resolves a source plugin and one safe cache target, returning diagnostics without mutation. */
export async function resolveContext(options: CodexToolsOptions = {}): Promise<ResolvedContext> {
  let repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  let packageJson: UnknownRecord;
  let pluginJson: UnknownRecord;
  try {
    repoRoot = await realpath(repoRoot);
    const packageValue = await json(path.join(repoRoot, 'package.json'));
    const pluginValue = await json(path.join(repoRoot, '.codex-plugin/plugin.json'));
    if (
      !object(packageValue) ||
      typeof packageValue.version !== 'string' ||
      !packageValue.version ||
      !object(pluginValue) ||
      !segment(pluginValue.name) ||
      (pluginValue.version !== undefined &&
        (typeof pluginValue.version !== 'string' || !pluginValue.version))
    ) {
      throw new Error('Source package/plugin identity is invalid.');
    }
    packageJson = packageValue;
    pluginJson = pluginValue;
  } catch (error) {
    const failure = asError(error);
    failure.source = { path: repoRoot, valid: false, issue: failure.message };
    throw failure;
  }

  const declaredValue = packageJson.codexTools ?? {};
  const known = new Set([
    'managedPaths',
    'excludeNames',
    'marketplace',
    'missingTarget',
    'absentCheck',
  ]);
  if (!object(declaredValue) || Object.keys(declaredValue).some((key) => !known.has(key))) {
    throw new Error('Invalid package.json codexTools configuration.');
  }
  const config: CacheConfiguration = {
    managedPaths: managedList(options.managedPaths ?? declaredValue.managedPaths),
    excludeNames: stringList(options.excludeNames ?? declaredValue.excludeNames, []),
    marketplace: marketplaceName(options.marketplace ?? declaredValue.marketplace),
    missingTarget: missingTarget(options.missingTarget ?? declaredValue.missingTarget),
    absentCheck: absentCheck(options.absentCheck ?? declaredValue.absentCheck),
  };
  selection(config);

  const packageVersion = packageJson.version;
  const pluginName = pluginJson.name;
  if (typeof packageVersion !== 'string' || typeof pluginName !== 'string') {
    throw new Error('Source package/plugin identity is invalid.');
  }
  const identity: PluginIdentity = {
    name: pluginName,
    version: typeof pluginJson.version === 'string' ? pluginJson.version : packageVersion,
    packageVersion,
  };
  const rawHome = path.resolve(
    options.codexHome ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex'),
  );
  let codexHome = rawHome;
  try {
    codexHome = await realpath(rawHome);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  const cacheRoot = path.join(codexHome, 'plugins/cache');
  let marketplace = config.marketplace;
  let codexConfig: UnknownRecord = {};
  let configObserved = false;
  try {
    const parsed = parseToml(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
    if (!object(parsed)) throw new Error('Unsupported Codex configuration.');
    codexConfig = parsed;
    configObserved = true;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }

  const candidates: InstallationCandidate[] = [];
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
      cachePath = path.join(codexHome, relative);
    }
  }
  let resolutionIssue: string | null = null;
  if (!cachePath) {
    if (matching.length === 1) {
      const match = matching[0]!;
      cachePath = match.cachePath;
      marketplace = match.marketplace;
    } else {
      resolutionIssue =
        matching.length > 1
          ? 'ambiguous exact-version caches; select --marketplace and/or --cache-path'
          : 'no exact-version cache found; install through Codex or select an explicit raw target';
    }
  }

  const baseInspection = cachePath
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
    if (baseInspection.cachePresent && baseInspection.issue === 'cache path is not a directory') {
      resolutionIssue = baseInspection.issue;
    }
    const relative = path.relative(cacheRoot, cachePath).split(path.sep);
    const [market, name] = relative;
    if (
      relative.length === 3 &&
      market !== undefined &&
      name !== undefined &&
      relative.every(segment) &&
      name === identity.name
    ) {
      if (marketplace && marketplace !== market) {
        resolutionIssue = 'cache path does not match selected marketplace';
      } else {
        marketplace = market;
        layoutVerified = true;
      }
      if (baseInspection.cachePresent) {
        layoutVerified = layoutVerified && (await realpath(cachePath)) === cachePath;
      }
    }
  }

  const key = marketplace ? identity.name + '@' + marketplace : null;
  const plugins = codexConfig.plugins;
  if (plugins !== undefined && !object(plugins)) {
    throw new Error('Unsupported plugin configuration for selected installation.');
  }
  const configured = key && object(plugins) ? plugins[key] : undefined;
  if (
    configured !== undefined &&
    (!object(configured) ||
      (configured.enabled !== undefined && typeof configured.enabled !== 'boolean'))
  ) {
    throw new Error('Unsupported plugin configuration for selected installation.');
  }
  const registered = key && configObserved ? configured !== undefined : null;
  const enabled =
    object(configured) && typeof configured.enabled === 'boolean' ? configured.enabled : null;
  const inspection: InstallationInspection = {
    ...baseInspection,
    installed: Boolean(
      config.missingTarget !== 'create' &&
      layoutVerified &&
      baseInspection.compatible &&
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
