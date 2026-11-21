/** operation names accepted by the library after cli command normalization. */
export type OperationCommand = 'check' | 'sync' | 'status' | 'doctor' | 'install' | 'refresh';
/** controls whether cache synchronization may create an explicit raw target. */
export type MissingTarget = 'require-installed' | 'create';
/** controls whether a missing installation fails read-only inspection. */
export type AbsentCheck = 'fail' | 'neutral';

/** options shared by cli parsing and the public operation functions. */
export interface CodexToolsOptions {
  /** local plugin source; defaults to the current working directory. */
  repoRoot?: string;
  /** explicit installed cache or opted-in raw synchronization target. */
  cachePathOverride?: string;
  /** selected codex home; defaults to `CODEX_HOME` or `~/.codex`. */
  codexHome?: string;
  /** marketplace name used for selection or disambiguation. */
  marketplace?: string;
  /** local marketplace catalog used only by install or refresh. */
  marketplacePath?: string;
  missingTarget?: MissingTarget;
  absentCheck?: AbsentCheck;
  /** `npm:` package selector used instead of a local source. */
  npmSelector?: string;
  /** managed relative paths, or `null` for whole-tree selection. */
  managedPaths?: readonly string[] | null;
  /** additional consumer-owned basenames excluded at every depth. */
  excludeNames?: readonly string[];
  help?: boolean;
  version?: boolean;
  json?: boolean;
  debug?: boolean;
  /** plans install, refresh, or sync without writes or child processes. */
  dryRun?: boolean;
}
