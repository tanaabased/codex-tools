import { randomUUID } from 'node:crypto';
import { chmod, lstat, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { asError } from '../utils/errors.ts';
import parseToml from '../utils/parse-toml.ts';
import { collectEntries } from './cache.ts';
import {
  assertSupportedCodexVersion,
  readNativeResult,
  readNativeRows,
  runNative,
} from './codex-native.ts';
import type { NativeResult } from './codex-native.ts';
import { inside, object, optional, resolveInstall, snapshot } from './install-context.ts';
import type { UnknownRecord } from './install-context.ts';
import type {
  InstallDependencies,
  InstallationEffects,
  InstallationResult,
  InstallOptions,
  ManifestEdit,
  OperationStep,
} from './install-types.ts';
import { installNpmPlugin } from './npm-install.ts';
import diffEntries from '../utils/diff-entries.ts';
import hasDiff from '../utils/has-diff.ts';

interface NativeInstalled extends UnknownRecord {
  pluginId: string;
  installed?: unknown;
  enabled?: unknown;
  name?: unknown;
  marketplaceName?: unknown;
  version?: unknown;
  source?: unknown;
}

function operationArgv(operation: OperationStep): string[] {
  if (!Array.isArray(operation.argv)) throw new Error('Refresh plan is missing command arguments.');
  return operation.argv;
}

// Plugin Creator's prefix-before-+ and single +codex.<UTC timestamp> convention.
export async function planCachebuster(
  version: unknown,
  cacheRoot: string,
  now: Date = new Date(),
): Promise<string> {
  if (typeof version !== 'string' || !version.trim())
    throw new Error('Refresh requires a non-empty source manifest version.');
  const occupied = new Set((await optional(() => readdir(cacheRoot))) ?? []);
  occupied.add(version);
  const base = version.split('+', 1)[0];
  if (!base) throw new Error('Refresh requires a non-empty base version.');
  const date = new Date(now);
  let next: string;
  do {
    next = base + '+codex.' + date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    date.setUTCSeconds(date.getUTCSeconds() + 1);
  } while (occupied.has(next));
  return next;
}

/** Refreshes an existing local or npm-backed installation without changing unrelated Codex state. */
export async function refreshPlugin(
  options: InstallOptions = {},
  { env = process.env, native = runNative, now = new Date(), npm }: InstallDependencies = {},
): Promise<InstallationResult> {
  if (options.npmSelector)
    return installNpmPlugin(
      { ...options, command: 'refresh' },
      { env, native, ...(npm ? { npm } : {}) },
    );
  const context = await resolveInstall(options, env);
  const { source, root, home, catalog, catalogFile, mapping } = context;
  if (
    context.createCodexHome ||
    !context.catalogSnapshot ||
    context.editCatalog ||
    context.addMapping ||
    context.register ||
    context.directories.length
  )
    throw new Error(
      'Refresh requires an existing local marketplace and matching source mapping; run install first.',
    );
  if (!mapping || !source.original || typeof source.manifest.version !== 'string') {
    throw new Error(
      'Refresh requires an existing local marketplace and matching source mapping; run install first.',
    );
  }
  const codexHome = await realpath(context.codexHome);
  if (inside(source.root, codexHome))
    throw new Error('Plugin source overlaps the selected Codex home.');
  const pluginId = source.manifest.name + '@' + catalog.name;
  const cacheRoot = path.join(codexHome, 'plugins/cache', catalog.name, source.manifest.name);
  async function checkCacheParents() {
    let current = codexHome;
    for (const part of path.relative(codexHome, cacheRoot).split(path.sep)) {
      current = path.join(current, part);
      const stats = await optional(() => lstat(current));
      if (stats && !stats.isDirectory())
        throw new Error('Native cache parent must be a real directory: ' + current);
    }
  }
  await checkCacheParents();
  const nextVersion = await planCachebuster(source.manifest.version, cacheRoot, now);
  const cachePath = path.join(cacheRoot, nextVersion);
  const manifestText = JSON.stringify({ ...source.manifest, version: nextVersion }, null, 2) + '\n';
  const expectedSource = await collectEntries(source.root);
  if ([...expectedSource.values()].some((entry) => entry.type === 'symlink'))
    throw new Error(
      'Native Codex skips payload symlinks; refresh requires a regular-file payload.',
    );
  const result: InstallationResult & {
    effects: InstallationEffects;
    manifestEdit: ManifestEdit;
  } = {
    command: 'refresh',
    source: {
      path: source.root,
      valid: true,
      name: source.manifest.name,
      version: source.manifest.version,
      validation: 'basic installation prerequisites only; full plugin validation is not provided',
    },
    codexHome,
    marketplace: catalog.name,
    marketplaceRoot: root,
    catalogPath: catalogFile,
    mapping: { path: mapping, target: source.root },
    pluginId,
    cachePath,
    dryRun: Boolean(options.dryRun),
    ok: false,
    status: 'planned',
    issue: null,
    manifestEdit: {
      path: source.file,
      before: source.manifest.version,
      after: nextVersion,
      applied: false,
    },
    inspection: {
      phase: 'pending',
      installed: null,
      enabled: null,
      payload: 'pending',
      authentication: 'unknown',
      activation: 'unknown',
    },
    effects: { reinstallAttempted: false, nativeSucceeded: false, preservation: 'pending' },
    guidance:
      'Start a new Codex task to pick up refreshed skills and tools; restart Codex if they remain unavailable. Existing-task pickup is unverified.',
    plan: [
      { operation: 'preflight', argv: ['--version'] },
      { operation: 'inspect-marketplaces', argv: ['plugin', 'marketplace', 'list', '--json'] },
      {
        operation: 'inspect-installation',
        argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
      },
      {
        operation: 'edit-manifest',
        path: source.file,
        before: source.manifest.version,
        after: nextVersion,
      },
      { operation: 'reinstall', argv: ['plugin', 'add', '--json', '--', pluginId] },
      {
        operation: 'readback',
        argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
      },
      { operation: 'verify-payload', path: cachePath },
      { operation: 'verify-preservation' },
    ],
    completed: [],
    remaining: [],
    native: [],
  };
  result.remaining = [...result.plan];
  if (options.dryRun) {
    result.ok = true;
    result.issue =
      'Native compatibility, existing installation, enablement, and payload verification are pending; dry run starts no native process.';
    return result;
  }
  const nativeOptions = { env: { ...env, HOME: home, CODEX_HOME: codexHome }, cwd: home };
  let expectedManifest = source.original;
  let beforeInstalled: NativeInstalled[] | undefined;
  const unrelated = (installedRows: readonly NativeInstalled[]) =>
    installedRows
      .filter((row) => row.pluginId !== pluginId)
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  async function child(argv: readonly string[]): Promise<NativeResult> {
    const child = await native(argv, nativeOptions);
    result.native.push(child);
    if (argv[1] === 'add') result.effects.nativeSucceeded = child.exitCode === 0;
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
  async function unchanged(): Promise<void> {
    await checkCacheParents();
    const current = await resolveInstall(options, env);
    if (
      current.root !== root ||
      current.source.root !== source.root ||
      current.mapping !== mapping ||
      !isDeepStrictEqual(current.mappingStats, context.mappingStats) ||
      !isDeepStrictEqual(current.catalogSnapshot, context.catalogSnapshot)
    )
      throw new Error('Marketplace or source mapping changed during refresh.');
    const configMatches = result.effects.reinstallAttempted
      ? isDeepStrictEqual(
          parseToml(current.configSnapshot?.text ?? ''),
          parseToml(context.configSnapshot?.text ?? ''),
        )
      : isDeepStrictEqual(current.configSnapshot, context.configSnapshot);
    if (!configMatches)
      throw new Error('Codex configuration changed during refresh; preservation is incomplete.');
    if (
      !isDeepStrictEqual(current.source.original, expectedManifest) ||
      !isDeepStrictEqual(await collectEntries(source.root), expectedSource)
    )
      throw new Error('Source changed during refresh; rerun with a stable source.');
  }
  async function readback(argv: readonly string[], refreshed: boolean): Promise<void> {
    const installedRows = readNativeRows(await call(argv), 'installed') as NativeInstalled[];
    const matches = installedRows.filter((row) => row.pluginId === pluginId);
    const found = matches[0];
    if (matches.length !== 1 || found?.installed !== true)
      throw new Error(
        'Selected installation is absent or ambiguous; refresh requires an installed plugin.',
      );
    const foundSource = object(found.source) ? found.source : {};
    if (
      found.name !== source.manifest.name ||
      found.marketplaceName !== catalog.name ||
      foundSource.source !== 'local' ||
      typeof foundSource.path !== 'string' ||
      (await realpath(foundSource.path)) !== source.root
    )
      throw new Error('Installed plugin source does not match selected local source.');
    result.inspection = {
      ...result.inspection,
      phase: refreshed ? 'readback' : 'before-reinstall',
      installed: true,
      enabled: typeof found.enabled === 'boolean' ? found.enabled : null,
      ...(typeof found.version === 'string' ? { version: found.version } : {}),
    };
    if (typeof found.version !== 'string' || typeof found.enabled !== 'boolean')
      throw new Error('Unsupported native installation state.');
    if (!found.enabled)
      throw new Error(
        'Disabled plugin cannot be refreshed without enabling it: native add enables plugins. Enable it explicitly in Codex first.',
      );
    if (refreshed) {
      if (found.version !== nextVersion)
        throw new Error('Native reinstall did not select the refreshed version.');
      if (!isDeepStrictEqual(unrelated(installedRows), unrelated(beforeInstalled ?? [])))
        throw new Error('Unrelated native installation state changed during refresh.');
    } else beforeInstalled = installedRows;
  }
  try {
    for (const operation of result.plan) {
      await unchanged();
      switch (operation.operation) {
        case 'preflight':
          result.codexVersion = assertSupportedCodexVersion(
            await callText(operationArgv(operation)),
          );
          break;
        case 'inspect-marketplaces': {
          const marketplaces = readNativeRows(await call(operationArgv(operation)), 'marketplaces');
          const matches = marketplaces.filter((row) => row.name === catalog.name);
          const match = matches[0];
          if (
            matches.length !== 1 ||
            !match ||
            typeof match.root !== 'string' ||
            (await realpath(match.root)) !== root ||
            (object(match.marketplaceSource) && match.marketplaceSource.sourceType !== 'local')
          )
            throw new Error(
              'Selected native marketplace is absent, ambiguous, or not the matching local source.',
            );
          break;
        }
        case 'inspect-installation':
          await readback(operationArgv(operation), false);
          break;
        case 'edit-manifest': {
          if (await optional(() => lstat(cachePath)))
            throw new Error('Planned cache version already exists; rerun to replan.');
          const temporary = source.file + '.' + randomUUID() + '.tmp';
          try {
            await writeFile(temporary, manifestText, { flag: 'wx', mode: source.original.mode });
            await chmod(temporary, source.original.mode & 0o777);
            // The temporary file is ours, not a concurrent source edit.
            expectedSource.set(path.relative(source.root, temporary), {
              type: 'file',
              mode: source.original.mode & 0o777,
              content: Buffer.from(manifestText),
            });
            await unchanged();
            await rename(temporary, source.file);
            result.manifestEdit.applied = true;
          } finally {
            await rm(temporary, { force: true });
            expectedSource.delete(path.relative(source.root, temporary));
          }
          const refreshedManifest = await snapshot(source.file);
          if (!refreshedManifest) throw new Error('Source manifest disappeared during refresh.');
          expectedManifest = refreshedManifest;
          const manifestEntry = expectedSource.get(path.relative(source.root, source.file));
          if (manifestEntry?.type !== 'file') {
            throw new Error('Source manifest is not a regular file.');
          }
          expectedSource.set(path.relative(source.root, source.file), {
            ...manifestEntry,
            content: Buffer.from(manifestText),
          });
          break;
        }
        case 'reinstall': {
          if (await optional(() => lstat(cachePath)))
            throw new Error('Planned cache version already exists; rerun to replan.');
          result.effects.reinstallAttempted = true;
          const data = await call(operationArgv(operation));
          if (
            !object(data) ||
            data.pluginId !== pluginId ||
            data.name !== source.manifest.name ||
            data.marketplaceName !== catalog.name ||
            data.version !== nextVersion ||
            data.installedPath !== cachePath
          )
            throw new Error(
              'Native reinstall returned an unexpected installation identity or path.',
            );
          break;
        }
        case 'readback':
          await readback(operationArgv(operation), true);
          break;
        case 'verify-payload': {
          if ((await realpath(cachePath)) !== cachePath || !(await lstat(cachePath)).isDirectory())
            throw new Error('Refreshed cache is not a regular installation directory.');
          result.diff = diffEntries(expectedSource, await collectEntries(cachePath));
          result.inspection.payload = hasDiff(result.diff) ? 'mismatch' : 'verified';
          if (hasDiff(result.diff))
            throw new Error('Refreshed payload does not match the source snapshot.');
          await unchanged();
          break;
        }
        case 'verify-preservation':
          result.effects.preservation = 'verified';
          break;
      }
      result.completed.push(operation);
      result.remaining = result.plan.slice(result.completed.length);
    }
    result.ok = true;
    result.status = 'refreshed';
  } catch (error) {
    result.status = 'incomplete';
    result.issue = asError(error).message;
    result.exitCode ??= 2;
    if (result.effects.reinstallAttempted)
      result.nativeState =
        'Native reinstall may have changed cache or configuration. Inspect before retrying; no rollback was attempted.';
    if (result.manifestEdit.applied)
      result.sourceEdit =
        'The source manifest was edited; no rollback was attempted. Inspect its current contents before retrying.';
  }
  return result;
}
