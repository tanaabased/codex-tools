export { collectEntries, inspectTrees, syncEntries } from './cache.ts';
export { inspectInstallation, resolveContext } from './context.ts';
export { runOperation } from './operations.ts';
export { runCLI } from './run-cli.ts';
export { default as diffEntries } from '../utils/diff-entries.ts';
export { installPlugin } from './install.ts';
export { refreshPlugin } from './refresh.ts';

export type { CollectEntriesOptions, TreeInspection, TreeOptions } from './cache.ts';
export type {
  CacheConfiguration,
  InstallationCandidate,
  InstallationInspection,
  PluginIdentity,
  ResolvedContext,
} from './context.ts';
export type { CLIRuntime, OutputStream } from './run-cli.ts';
export type { NativeOptions, NativeResult, NativeRunner } from './codex-native.ts';
export type {
  CacheCommand,
  CacheOperationResult,
  CacheStatus,
  OperationResult,
} from './operations.ts';
export type {
  InstallDependencies,
  InstallationResult,
  InstallOptions,
  OperationStep,
} from './install-types.ts';
export type { EntryMap, TreeDiff, TreeEntry } from '../utils/diff-entries.ts';
export type {
  AbsentCheck,
  CodexToolsOptions,
  MissingTarget,
  OperationCommand,
} from '../utils/parse-args.ts';
export type { CodexToolsError, SourceFailure } from '../utils/errors.ts';
