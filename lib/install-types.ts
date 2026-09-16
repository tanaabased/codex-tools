import type { NativeResult, NativeRunner } from './codex-native.ts';
import type { MarketplaceCatalog, NpmProvenance, ValidatedSource } from './install-context.ts';
import type { TreeDiff } from '../utils/diff-entries.ts';
import type { CodexToolsOptions } from '../utils/parse-args.ts';

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
  ok: boolean;
  status: string;
  issue: string | null;
  inspection: NativeInspection;
  plan: OperationStep[];
  completed: OperationStep[];
  remaining: OperationStep[];
  native: NativeResult[];
  effects?: InstallationEffects;
  manifestEdit?: ManifestEdit;
  diff?: TreeDiff;
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

export interface InstallDependencies {
  env?: NodeJS.ProcessEnv;
  native?: NativeRunner;
  npm?: NpmRunner;
  source?: ValidatedSource;
  refreshing?: boolean;
  now?: Date;
}

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
