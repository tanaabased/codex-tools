export { collectEntries, inspectTrees, syncEntries } from '../cache/cache.ts';
export { inspectInstallation, resolveContext } from '../cache/context.ts';
export { runOperation } from './operations.ts';
export { runCLI } from '../cli/run-cli.ts';
export { default as diffEntries } from '../cache/diff-entries.ts';
export { installPlugin } from '../install/install.ts';
export { refreshPlugin } from '../install/refresh.ts';

export type { CollectEntriesOptions, TreeInspection, TreeOptions } from '../cache/cache.ts';
export type {
  CacheConfiguration,
  InstallationCandidate,
  InstallationInspection,
  PluginIdentity,
  ResolvedContext,
} from '../cache/context.ts';
export type { CLIRuntime, OutputStream } from '../cli/run-cli.ts';
export type { NativeOptions, NativeResult, NativeRunner } from '../install/codex-native.ts';
export type { CacheCommand, CacheOperationResult, CacheStatus } from '../cache/cache-operation.ts';
export type { OperationResult } from './operations.ts';
export type {
  InstallDependencies,
  InstallationResult,
  InstallOptions,
  OperationStep,
} from '../install/install-types.ts';
export type { EntryMap, TreeDiff, TreeEntry } from '../cache/diff-entries.ts';
export type { AbsentCheck, CodexToolsOptions, MissingTarget, OperationCommand } from './options.ts';
export type { CodexToolsError, SourceFailure } from '../utils/errors.ts';
