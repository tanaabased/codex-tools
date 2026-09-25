import { isDeepStrictEqual } from 'node:util';
import {
  chmod,
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { asError } from '../utils/errors.ts';
import { assertSupportedCodexVersion, readNativeResult, readNativeRows } from './codex-native.ts';
import { provisionNativeRunner } from './codex-provision.ts';
import { collectEntries } from './cache.ts';
import type { FileSnapshot, UnknownRecord } from './install-context.ts';
import {
  inside,
  object,
  optional,
  resolveInstall,
  snapshot,
  validateSource,
} from './install-context.ts';
import type {
  InstallationResult,
  InternalInstallDependencies,
  InstallOptions,
  OperationStep,
} from './install-types.ts';
import type { NativeResult, NativeRunner } from './codex-native.ts';
import parseToml from '../utils/parse-toml.ts';

interface NativeInstalled extends UnknownRecord {
  pluginId: string;
  installed?: unknown;
  enabled?: unknown;
  name?: unknown;
  marketplaceName?: unknown;
  version?: unknown;
  authPolicy?: unknown;
  source?: unknown;
}

function operationArgv(operation: OperationStep): string[] {
  if (!Array.isArray(operation.argv))
    throw new Error('Installation plan is missing command arguments.');
  return operation.argv;
}

function operationPath(operation: OperationStep): string {
  if (typeof operation.path !== 'string') throw new Error('Installation plan is missing a path.');
  return operation.path;
}

function operationTarget(operation: OperationStep): string {
  if (typeof operation.target !== 'string')
    throw new Error('Installation plan is missing a target.');
  return operation.target;
}

export async function performInstall(
  options: InstallOptions = {},
  {
    env = process.env,
    native,
    provision = provisionNativeRunner,
    source: preparedSource,
    refreshing = false,
  }: InternalInstallDependencies = {},
): Promise<InstallationResult> {
  const context = await resolveInstall(options, env, preparedSource);
  const { source, root, home, codexHome, catalog, catalogFile, mapping } = context;
  const pluginId = source.manifest.name + '@' + catalog.name;
  const nativeOptions = { env: { ...env, HOME: home, CODEX_HOME: codexHome }, cwd: home };
  const result: InstallationResult = {
    command: refreshing ? 'refresh' : 'install',
    source: {
      path: source.root,
      valid: true,
      name: source.manifest.name,
      version: source.manifest.version ?? null,
      validation: 'basic installation prerequisites only; full plugin validation is not provided',
    },
    codexHome,
    marketplace: catalog.name,
    marketplaceRoot: root,
    catalogPath: catalogFile,
    mapping: mapping ? { path: mapping, target: source.root } : null,
    pluginId,
    dryRun: Boolean(options.dryRun),
    ok: false,
    status: 'planned',
    issue: null,
    inspection: {
      installed: false,
      enabled: null,
      authentication: 'unknown',
      activation: 'unknown',
    },
    plan: [],
    completed: [],
    remaining: [],
    native: [],
  };
  const step = (operation: string, extra: Omit<OperationStep, 'operation'> = {}) => {
    result.plan.push({ operation, ...extra });
  };
  step('preflight', { argv: ['--version'] });
  if (context.createCodexHome) step('create-codex-home', { path: codexHome });
  step('inspect-marketplaces', { argv: ['plugin', 'marketplace', 'list', '--json'] });
  step('inspect-installation', {
    argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
  });
  for (const directory of context.directories) step('mkdir', { path: directory });
  if (context.addMapping) {
    if (!mapping) throw new Error('Installation plan is missing a source mapping.');
    step('map-source', {
      path: mapping,
      target: path.relative(
        await context.paths.resolve(path.dirname(mapping), 'directory'),
        source.root,
      ),
    });
  }
  if (context.editCatalog)
    step('write-catalog', { path: catalogFile, target: context.catalogTarget, catalog });
  if (context.register)
    step('register-marketplace', { argv: ['plugin', 'marketplace', 'add', root, '--json'] });
  step('verify-marketplace', { argv: ['plugin', 'marketplace', 'list', '--json'] });
  step('install', {
    argv: ['plugin', 'add', '--json', '--', pluginId],
    condition: 'unless the same source/version is already installed',
  });
  step('readback', { argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name] });
  if (source.npm) step('verify-package');
  result.remaining = [...result.plan];
  if (options.dryRun) {
    result.ok = true;
    return result;
  }
  let expectedCatalog = context.catalogSnapshot;
  let expectedConfig = context.configSnapshot;
  let expectedMapping = context.mappingStats;
  let installed: NativeInstalled | undefined;
  let beforeInstalled: NativeInstalled[] | undefined;
  let runCodex: NativeRunner | undefined;
  const unrelated = (rows: readonly NativeInstalled[]) =>
    rows
      .filter((row) => row.pluginId !== pluginId)
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  async function unchanged(): Promise<void> {
    const observedFiles: Array<[string, FileSnapshot | null]> = [
      [source.file, source.original],
      [path.join(source.root, 'package.json'), context.packageSnapshot],
      [context.catalogTarget, expectedCatalog],
      [context.configFile, expectedConfig],
    ];
    for (const [file, expected] of observedFiles) {
      if (JSON.stringify(await snapshot(file)) !== JSON.stringify(expected))
        throw new Error('File changed during installation; rerun to replan: ' + file);
    }
    if (!mapping) {
      await context.paths.unchanged();
      return;
    }
    const stats = await optional(() => lstat(mapping));
    if (
      expectedMapping
        ? !stats ||
          stats.ino !== expectedMapping.ino ||
          stats.dev !== expectedMapping.dev ||
          (await realpath(mapping)) !== source.root
        : stats
    )
      throw new Error('Source mapping changed during installation.');
    await context.paths.unchanged();
  }
  async function child(argv: readonly string[]): Promise<NativeResult> {
    if (!runCodex) throw new Error('Managed Codex CLI is unavailable.');
    const child = await runCodex(argv, nativeOptions);
    result.native.push(child);
    if (child.exitCode !== 0) {
      result.nativeError = child;
      result.exitCode = child.exitCode;
    }
    return child;
  }
  async function call(argv: readonly string[]): Promise<unknown> {
    return readNativeResult(await child(argv));
  }
  async function callText(argv: readonly string[]): Promise<string> {
    return readNativeResult(await child(argv), { json: false });
  }
  async function markets(argv: readonly string[], required: boolean): Promise<void> {
    const rows = readNativeRows(await call(argv), 'marketplaces');
    const matches = rows.filter((market) => market.name === catalog.name);
    for (const market of rows) {
      if (
        market.name !== catalog.name &&
        typeof market.root === 'string' &&
        ((await optional(() => realpath(market.root as string))) === context.physicalRoot ||
          (await optional(() =>
            realpath(path.join(market.root as string, '.agents/plugins/marketplace.json')),
          )) === context.catalogTarget)
      )
        throw new Error('Native marketplace source is registered under another name.');
    }
    if (matches.length > 1 || (required && matches.length !== 1))
      throw new Error('Selected marketplace is missing or ambiguous in Codex.');
    if (
      matches.length &&
      (typeof matches[0]!.root !== 'string' ||
        (await realpath(matches[0]!.root)) !== context.physicalRoot ||
        (object(matches[0]!.marketplaceSource) &&
          matches[0]!.marketplaceSource.sourceType !== 'local'))
    )
      throw new Error('Native marketplace name/source collision.');
  }
  async function recordNativeConfig(registering = false): Promise<void> {
    const updated = await snapshot(context.configFile);
    const beforeValue = parseToml(expectedConfig?.text ?? '');
    const afterValue = parseToml(updated?.text ?? '');
    if (!object(beforeValue) || !object(afterValue)) {
      throw new Error('Unsupported Codex configuration.');
    }
    const before = beforeValue;
    const after = afterValue;
    for (const config of [before, after]) {
      const plugins = object(config.plugins) ? config.plugins : undefined;
      const plugin = plugins && object(plugins[pluginId]) ? plugins[pluginId] : undefined;
      if (!registering && plugins && plugin) {
        delete plugin.enabled;
        if (!Object.keys(plugin).length) delete plugins[pluginId];
        if (!Object.keys(plugins).length) delete config.plugins;
      }
      const marketplaces = object(config.marketplaces) ? config.marketplaces : undefined;
      if (registering && marketplaces) {
        delete marketplaces[catalog.name];
        if (!Object.keys(marketplaces).length) delete config.marketplaces;
      }
    }
    if (!isDeepStrictEqual(before, after))
      throw new Error('Unrelated Codex configuration changed during installation.');
    expectedConfig = updated;
  }
  async function npmPayloadMatches(): Promise<boolean> {
    if (!source.nativeVersion) throw new Error('Installed npm payload version is unavailable.');
    const cachePath = path.join(
      context.physicalCodexHome,
      'plugins/cache',
      catalog.name,
      source.manifest.name,
      source.nativeVersion,
    );
    if (!inside(context.physicalCodexHome, cachePath))
      throw new Error('Installed npm payload has an unexpected cache path.');
    if (!(await optional(() => lstat(cachePath)))) return false;
    if ((await realpath(cachePath)) !== cachePath)
      throw new Error('Installed npm cache must not be aliased.');
    return isDeepStrictEqual(await collectEntries(source.root), await collectEntries(cachePath));
  }
  async function readback(
    argv: readonly string[],
    final = false,
  ): Promise<NativeInstalled | undefined> {
    const rows = readNativeRows(await call(argv), 'installed');
    const installedRows = rows as NativeInstalled[];
    const matches = installedRows.filter((plugin) => plugin.pluginId === pluginId);
    if (matches.length > 1) throw new Error('Ambiguous native installation readback.');
    const found = matches[0];
    if (found) {
      if (typeof found.installed !== 'boolean' || typeof found.enabled !== 'boolean')
        throw new Error('Unsupported native installation state.');
      if (
        found.name !== source.manifest.name ||
        found.marketplaceName !== catalog.name ||
        !object(found.source)
      )
        throw new Error('Installed plugin source does not match selected source.');
      if (source.npm) {
        if (
          found.source.source !== 'npm' ||
          found.source.package !== source.npm.package ||
          found.source.registry !== source.npm.registry
        )
          throw new Error('Installed plugin source does not match selected npm source.');
        if (
          (final || refreshing) &&
          (found.source.version !== source.npm.version || found.version !== source.nativeVersion)
        )
          throw new Error(
            'Installed npm package or plugin version does not match the pinned release.',
          );
        if (
          !final &&
          found.installed &&
          !found.enabled &&
          (refreshing ||
            found.source.version !== source.npm.version ||
            found.version !== source.nativeVersion)
        )
          throw new Error(
            'Native add enables plugins. Enable this plugin explicitly in Codex before refreshing or selecting another release.',
          );
      } else {
        if (
          found.source.source !== 'local' ||
          typeof found.source.path !== 'string' ||
          (await realpath(found.source.path)) !== source.root
        )
          throw new Error('Installed plugin source does not match selected source.');
        if (source.manifest.version !== undefined && found.version !== source.manifest.version)
          throw new Error(
            'Another version is installed; use codex-tools refresh to reinstall the local source.',
          );
      }
    }
    if (source.npm) {
      if (!final) {
        beforeInstalled = installedRows;
        if (refreshing && found?.installed !== true)
          throw new Error('Refresh requires an existing installed npm plugin.');
      } else if (!isDeepStrictEqual(unrelated(installedRows), unrelated(beforeInstalled ?? [])))
        throw new Error('Unrelated native installation state changed during npm installation.');
    }
    return found;
  }
  try {
    runCodex = native ?? (await provision(env));
    for (const operation of result.plan) {
      await unchanged();
      switch (operation.operation) {
        case 'preflight': {
          result.codexVersion = assertSupportedCodexVersion(
            await callText(operationArgv(operation)),
          );
          break;
        }
        case 'create-codex-home':
          await mkdir(codexHome, { recursive: true });
          await context.paths.createdDirectory(context.physicalCodexHome);
          break;
        case 'inspect-marketplaces':
          await markets(operationArgv(operation), false);
          break;
        case 'inspect-installation':
          installed = await readback(operationArgv(operation));
          break;
        case 'mkdir': {
          const physical = await context.paths.resolve(operationPath(operation), 'directory');
          await mkdir(physical);
          await context.paths.createdDirectory(physical);
          break;
        }
        case 'map-source': {
          if (!mapping) throw new Error('Installation plan is missing a source mapping.');
          await symlink(operationTarget(operation), mapping, 'dir');
          const stats = await lstat(mapping);
          expectedMapping = { ino: stats.ino, dev: stats.dev };
          break;
        }
        case 'write-catalog': {
          const temporary = context.catalogTarget + '.' + randomUUID() + '.tmp';
          const text = JSON.stringify(catalog, null, 2) + '\n';
          try {
            await writeFile(temporary, text, {
              flag: 'wx',
              mode: expectedCatalog?.mode ?? 0o644,
            });
            await chmod(temporary, (expectedCatalog?.mode ?? 0o644) & 0o777);
            await unchanged();
            if (expectedCatalog) await rename(temporary, context.catalogTarget);
            else {
              // exclusive creation keeps an intervening catalog from being replaced.
              await link(temporary, context.catalogTarget);
              await rm(temporary);
            }
            const written = await snapshot(context.catalogTarget);
            if (
              written?.text !== text ||
              (written.mode & 0o777) !== ((expectedCatalog?.mode ?? 0o644) & 0o777)
            )
              throw new Error('Written catalog changed during installation.');
            expectedCatalog = written;
          } finally {
            await rm(temporary, { force: true });
          }
          break;
        }
        case 'register-marketplace':
          await mkdir(codexHome, { recursive: true });
          await call(operationArgv(operation));
          await recordNativeConfig(true);
          break;
        case 'verify-marketplace':
          await markets(operationArgv(operation), true);
          break;
        case 'install': {
          const installedSource = object(installed?.source) ? installed.source : {};
          if (
            !refreshing &&
            installed?.installed === true &&
            (!source.npm ||
              (installedSource.version === source.npm.version &&
                installed.version === source.nativeVersion))
          ) {
            if (!source.npm || (await npmPayloadMatches())) {
              operation.skipped = true;
              break;
            }
            if (!installed.enabled)
              throw new Error(
                'Enable this plugin explicitly in Codex before repairing its npm payload.',
              );
          }
          await mkdir(codexHome, { recursive: true });
          await call(operationArgv(operation));
          await recordNativeConfig();
          break;
        }
        case 'verify-package': {
          if (!source.nativeVersion)
            throw new Error('Installed npm payload version is unavailable.');
          const cachePath = path.join(
            context.physicalCodexHome,
            'plugins/cache',
            catalog.name,
            source.manifest.name,
            source.nativeVersion,
          );
          if (
            !inside(context.physicalCodexHome, cachePath) ||
            (await realpath(cachePath)) !== cachePath
          )
            throw new Error('Installed npm payload has an unexpected cache path.');
          const actual = await validateSource(cachePath, { portable: true });
          if (
            actual.manifest.name !== source.manifest.name ||
            !isDeepStrictEqual(await collectEntries(source.root), await collectEntries(cachePath))
          )
            throw new Error('Installed npm payload does not match the inspected package.');
          result.inspection.payload = 'verified';
          result.cachePath = cachePath;
          break;
        }
        case 'readback': {
          installed = await readback(operationArgv(operation), true);
          result.inspection = {
            installed: installed?.installed === true,
            enabled: typeof installed?.enabled === 'boolean' ? installed.enabled : null,
            authentication: 'unknown',
            authPolicy: typeof installed?.authPolicy === 'string' ? installed.authPolicy : null,
            activation: 'unknown',
          };
          if (!result.inspection.installed)
            throw new Error('Native install completed but installation was not observed.');
          break;
        }
      }
      await unchanged();
      result.completed.push(operation);
      result.remaining = result.plan.slice(result.completed.length);
    }
    result.ok = true;
    result.status = refreshing
      ? 'refreshed'
      : result.inspection.enabled === true
        ? 'installed'
        : 'installed_pending_enablement';
    result.issue =
      'Authentication and activation in an active Codex task are not observable through this native CLI.';
  } catch (error) {
    result.status = 'incomplete';
    const remainingOperation = result.remaining[0]?.operation;
    if (
      remainingOperation !== undefined &&
      ['install', 'register-marketplace'].includes(remainingOperation)
    )
      result.nativeState =
        'The failed native operation may have changed Codex state; rerun to inspect and resume.';
    result.issue = asError(error).message;
    result.exitCode ??= 2;
  }
  return result;
}
