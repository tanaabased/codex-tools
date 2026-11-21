import type { CodexToolsOptions, OperationCommand } from '../codex/options.ts';
import { inspectTrees, syncEntries, type TreeOptions } from './cache.ts';
import { inspectInstallation, resolveContext } from './context.ts';
import type { InstallationCandidate, InstallationInspection, PluginIdentity } from './context.ts';
import type { TreeDiff } from './diff-entries.ts';
import hasDiff from './has-diff.ts';

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

export async function runCacheOperation(
  command: CacheCommand,
  options: CodexToolsOptions,
): Promise<CacheOperationResult> {
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
