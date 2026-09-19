import { inspectInstallation, resolveContext } from './context.ts';
import type { InstallationCandidate, InstallationInspection, PluginIdentity } from './context.ts';
import { inspectTrees, syncEntries } from './cache.ts';
import type { TreeOptions } from './cache.ts';
import { installPlugin } from './install.ts';
import { refreshPlugin } from './refresh.ts';
import type { InstallDependencies, InstallationResult } from './install-types.ts';
import type { TreeDiff } from '../utils/diff-entries.ts';
import hasDiff from '../utils/has-diff.ts';
import type { CodexToolsOptions, OperationCommand } from '../utils/parse-args.ts';

/** read-only and synchronizing operations that use the cache reconciliation contract. */
export type CacheCommand = Exclude<OperationCommand, 'install' | 'refresh'>;
/** stable cache-operation states returned to cli and library consumers. */
export type CacheStatus =
  'not_installed' | 'unresolved' | 'planned' | 'synchronized_directory' | 'current' | 'drifted';

/** normalized result returned by status, doctor, cache check, and cache sync. */
export interface CacheOperationResult {
  command: CacheCommand;
  source: { path: string; valid: true } & PluginIdentity;
  codexHome: string;
  cachePath: string | null;
  marketplace: string | null;
  inspection: InstallationInspection;
  candidates: InstallationCandidate[];
  selection: {
    managedPaths: readonly string[] | null;
    excludeNames: readonly string[];
  };
  diff: TreeDiff | null;
  /** stable machine-readable operation state. */
  status: CacheStatus;
  /** whether the requested observation or synchronization satisfied its contract. */
  ok: boolean;
  dryRun: boolean;
  /** human-readable reason for an unsuccessful or unresolved result. */
  issue: string | null;
}

/** result union returned by the shared operation layer. */
export type OperationResult = CacheOperationResult | InstallationResult;

/**
 * runs one supported operation without rendering output or changing process exit state.
 *
 * status, doctor, and check are read-only. sync writes only when `dryRun` is false. install and
 * refresh can update source, marketplace, cache, and native codex state; partial failures are
 * reported in their structured result and are not automatically rolled back.
 *
 * @example
 * ```js
 * const { runOperation } = require('@tanaab/codex-tools');
 *
 * runOperation('install', {
 *   npmSelector: 'npm:@scope/plugin@1.2.3',
 *   dryRun: true,
 * }).then((result) => console.log(result.status));
 * ```
 * @param command supported operation name. cli `cache check` and `cache sync` map to `check` and
 * `sync` here.
 * @param options source selection, codex state, output-independent behavior, and dry-run settings.
 * @param runtime injectable environment and native/npm process boundaries for install or refresh.
 * @returns the normalized cache or installation result used by json output.
 * @throws when the command, source, configuration, filesystem, or operation preconditions are
 * invalid. native operational failures are ordinarily returned as structured results.
 */
export function runOperation(
  command: 'install' | 'refresh',
  options?: CodexToolsOptions,
  runtime?: InstallDependencies,
): Promise<InstallationResult>;
export function runOperation(
  command: CacheCommand,
  options?: CodexToolsOptions,
  runtime?: InstallDependencies,
): Promise<CacheOperationResult>;
export function runOperation(
  command: OperationCommand,
  options?: CodexToolsOptions,
  runtime?: InstallDependencies,
): Promise<OperationResult>;
export async function runOperation(
  command: OperationCommand,
  options: CodexToolsOptions = {},
  runtime: InstallDependencies = {},
): Promise<OperationResult> {
  if (command === 'refresh') return refreshPlugin(options, runtime);
  if (command === 'install') return installPlugin(options, runtime);
  if (!['check', 'sync', 'status', 'doctor'].includes(command))
    throw new Error('Unknown cache operation.');
  const context = await resolveContext(options);
  const {
    repoRoot,
    codexHome,
    cachePath,
    marketplace,
    identity,
    inspection,
    candidates,
    config,
    resolutionIssue,
  } = context;
  const result: CacheOperationResult = {
    command,
    source: { path: repoRoot, valid: true, ...identity },
    codexHome,
    cachePath,
    marketplace,
    inspection,
    candidates,
    selection: { managedPaths: config.managedPaths, excludeNames: config.excludeNames },
    diff: null,
    status: 'not_installed',
    ok: false,
    dryRun: Boolean(options.dryRun),
    issue: resolutionIssue ?? inspection.issue ?? null,
  };
  const raw = config.missingTarget === 'create' && Boolean(options.cachePathOverride);
  if (resolutionIssue && (cachePath || candidates.some((candidate) => candidate.compatible))) {
    result.status = 'unresolved';
    return result;
  }
  if (!inspection.installed && !raw) {
    result.ok = command !== 'sync' && config.absentCheck === 'neutral';
    return result;
  }
  if (!cachePath) return result;
  const treeOptions: TreeOptions = {
    sourceRoot: repoRoot,
    targetRoot: cachePath,
    managedPaths: config.managedPaths,
    excludeNames: config.excludeNames,
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
  };
  if (command === 'sync') {
    result.diff = await syncEntries(treeOptions);
    if (!options.dryRun) {
      result.inspection = { ...inspection, ...(await inspectInstallation(cachePath, identity)) };
      result.inspection.installed = inspection.installed && result.inspection.compatible;
      result.issue = result.inspection.issue;
    }
    result.ok = Boolean(
      options.dryRun || (!hasDiff(result.diff) && (raw || result.inspection.installed)),
    );
    result.status = options.dryRun
      ? 'planned'
      : result.ok
        ? raw && !inspection.installed
          ? 'synchronized_directory'
          : 'current'
        : 'drifted';
  } else {
    result.diff = (await inspectTrees(treeOptions)).diff;
    result.ok = !hasDiff(result.diff);
    result.status = result.ok
      ? raw && !inspection.installed
        ? 'synchronized_directory'
        : 'current'
      : 'drifted';
  }
  return result;
}
