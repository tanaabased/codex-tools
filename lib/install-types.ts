import type { NativeResult, NativeRunner } from './codex-native.ts';
import type { MarketplaceCatalog, NpmProvenance, ValidatedSource } from './install-context.ts';
import type { TreeDiff } from '../utils/diff-entries.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';

/** one planned, completed, or remaining installation-side operation. */
export interface OperationStep extends Record<string, unknown> {
  operation: string;
  argv?: string[];
  path?: string;
  target?: string;
  condition?: string;
  version?: string | null;
  before?: string;
  after?: string;
  skipped?: boolean;
  catalog?: MarketplaceCatalog;
}

export interface InstallationSource extends Record<string, unknown> {
  path?: string | null;
  type?: 'npm';
  requested?: string;
  package?: string;
  registry?: string | null;
  name?: string | null;
  version?: string | null;
  pluginVersion?: string;
  valid: boolean | null;
  validation: string;
}

export interface NativeInspection extends Record<string, unknown> {
  installed: boolean | null;
  enabled: boolean | null;
  authentication: string;
  activation: string;
  phase?: string;
  payload?: string;
  version?: string;
  authPolicy?: string | null;
}

export interface InstallationEffects extends Record<string, unknown> {
  reinstallAttempted: boolean;
  nativeSucceeded: boolean;
  preservation: string;
}

export interface ManifestEdit {
  path: string;
  before: string;
  after: string;
  applied: boolean;
}

/** structured install or refresh result, including partial effects and native diagnostics. */
export interface InstallationResult extends Record<string, unknown> {
  command: 'install' | 'refresh';
  source: InstallationSource;
  codexHome: string;
  marketplace: string;
  marketplaceRoot: string;
  catalogPath: string;
  mapping: { path: string; target: string } | null;
  pluginId?: string;
  cachePath?: string;
  dryRun: boolean;
  /** whether final readback satisfied the requested install or refresh contract. */
  ok: boolean;
  /** stable machine-readable lifecycle state such as `planned`, `installed`, or `incomplete`. */
  status: string;
  /** human-readable reason for an unsuccessful or incomplete result. */
  issue: string | null;
  inspection: NativeInspection;
  plan: OperationStep[];
  /** planned steps observed as complete before the result was returned. */
  completed: OperationStep[];
  /** planned steps not verified as complete. */
  remaining: OperationStep[];
  /** sanitized native child-process results retained by the operation. */
  native: NativeResult[];
  effects?: InstallationEffects;
  manifestEdit?: ManifestEdit;
  diff?: TreeDiff;
  /** native child exit code preserved for cli callers when available. */
  exitCode?: number;
  nativeError?: NativeResult;
  codexVersion?: string;
  npmVersion?: string;
  nativeState?: string;
  sourceEdit?: string;
  guidance?: string;
  acquisition?: { method: string; staging: string } & Record<string, unknown>;
}

export type NpmRunner = NativeRunner;

/** injectable environment, process, source, and clock boundaries for installation operations. */
export interface InstallDependencies {
  env?: NodeJS.ProcessEnv;
  native?: NativeRunner;
  npm?: NpmRunner;
  source?: ValidatedSource;
  refreshing?: boolean;
  now?: Date;
}

/** public operation options with an optional explicit install or refresh command marker. */
export interface InstallOptions extends CodexToolsOptions {
  command?: 'install' | 'refresh';
}

export interface NpmPinnedEntry extends Record<string, unknown> {
  name: string;
  source: {
    source: 'npm';
    package: string;
    version: string;
    registry: string;
  } & Record<string, unknown>;
  codexTools?: { npm?: NpmProvenance } & Record<string, unknown>;
}
