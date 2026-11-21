import {
  runCacheOperation,
  type CacheCommand,
  type CacheOperationResult,
} from '../cache/cache-operation.ts';
import { installPlugin } from '../install/install.ts';
import type { InstallationResult, InstallDependencies } from '../install/install-types.ts';
import { refreshPlugin } from '../install/refresh.ts';
import type { CodexToolsOptions, OperationCommand } from './options.ts';

/** result union returned by the shared operation layer. */
export type OperationResult = CacheOperationResult | InstallationResult;

/**
 * runs one supported operation without rendering output or changing process exit state.
 *
 * `status`, `doctor`, and `check` are read-only. use `dryRun` to preview `sync`, `install`, or
 * `refresh`. completed install or refresh steps can remain in effect after failure.
 *
 * @example
 * review the files that would change before deciding whether to sync.
 *
 * ```js
 * import { runOperation } from '@tanaab/codex-tools';
 *
 * const result = await runOperation('check', { repoRoot: '/path/to/plugin' });
 * if (!result.diff) throw new Error(result.issue ?? 'No cache could be compared.');
 *
 * const { changed, extra, missing } = result.diff;
 * console.log({ changed, extra, missing });
 * ```
 *
 * @param command use `check` for `cache check` and `sync` for `cache sync`.
 * @returns the result the CLI reports with `--json`.
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
  return runCacheOperation(command, options);
}
