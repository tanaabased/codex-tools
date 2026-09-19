import { parseNpmSelector } from './npm-selector.ts';

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

export interface ParsedOptions extends CodexToolsOptions {
  command: OperationCommand | '';
  help: boolean;
}

type StringOption =
  | 'repoRoot'
  | 'cachePathOverride'
  | 'codexHome'
  | 'marketplace'
  | 'marketplacePath'
  | 'missingTarget'
  | 'absentCheck';
type BooleanOption = 'help' | 'version' | 'json' | 'debug' | 'dryRun';

const strings = new Map<string, StringOption>([
  ['repo-root', 'repoRoot'],
  ['cache-path', 'cachePathOverride'],
  ['codex-home', 'codexHome'],
  ['marketplace', 'marketplace'],
  ['marketplace-path', 'marketplacePath'],
  ['missing-target', 'missingTarget'],
  ['absent-check', 'absentCheck'],
]);
const booleans = new Map<string, BooleanOption>([
  ['help', 'help'],
  ['version', 'version'],
  ['json', 'json'],
  ['debug', 'debug'],
  ['dry-run', 'dryRun'],
]);

const commands = new Set<OperationCommand>([
  'check',
  'sync',
  'status',
  'doctor',
  'install',
  'refresh',
]);

function operationCommand(value: string): value is OperationCommand {
  return commands.has(value as OperationCommand);
}

function setStringOption(options: CodexToolsOptions, key: StringOption, value: string): void {
  switch (key) {
    case 'missingTarget':
      options.missingTarget = value as MissingTarget;
      break;
    case 'absentCheck':
      options.absentCheck = value as AbsentCheck;
      break;
    case 'repoRoot':
      options.repoRoot = value;
      break;
    case 'cachePathOverride':
      options.cachePathOverride = value;
      break;
    case 'codexHome':
      options.codexHome = value;
      break;
    case 'marketplace':
      options.marketplace = value;
      break;
    case 'marketplacePath':
      options.marketplacePath = value;
      break;
  }
}

function setBooleanOption(options: CodexToolsOptions, key: BooleanOption, value: boolean): void {
  options[key] = value;
}

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedOptions {
  const options: CodexToolsOptions = {};
  const positionals: string[] = [];
  const explicit = new Set<keyof CodexToolsOptions>();
  const aliases: Record<string, string> = { '-h': '--help', '-V': '--version', '-v': '--version' };
  for (let i = 0; i < argv.length; i++) {
    const original = argv[i]!;
    const arg = aliases[original] ?? original;
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const [flag = '', ...parts] = arg.slice(2).split('=');
    const value = parts.length ? parts.join('=') : undefined;
    const negative = flag.startsWith('no-');
    const boolean = booleans.get(negative ? flag.slice(3) : flag);
    if (arg.startsWith('--') && boolean) {
      if (value !== undefined) throw new Error('Flag --' + flag + ' does not accept a value.');
      if (explicit.has(boolean)) throw new Error('Repeated option: --' + flag);
      explicit.add(boolean);
      setBooleanOption(options, boolean, !negative);
    } else if (arg.startsWith('--') && strings.has(flag)) {
      const key = strings.get(flag)!;
      if (explicit.has(key)) throw new Error('Repeated option: --' + flag);
      const next = value ?? argv[++i];
      if (!next || next.startsWith('-')) throw new Error('Flag --' + flag + ' requires a value.');
      explicit.add(key);
      setStringOption(options, key, next);
    } else throw new Error('Unknown option: ' + arg);
  }
  for (const [flag, key] of strings) {
    const value = env['CODEX_TOOLS_' + flag.replaceAll('-', '_').toUpperCase()];
    if (!explicit.has(key) && value) setStringOption(options, key, value);
  }
  for (const [flag, key] of booleans) {
    if (['help', 'version'].includes(key) || explicit.has(key)) continue;
    const value = env['CODEX_TOOLS_' + flag.replaceAll('-', '_').toUpperCase()];
    if (value !== undefined) {
      if (!['1', '0', 'true', 'false'].includes(value))
        throw new Error('Invalid boolean environment value for --' + flag);
      setBooleanOption(options, key, value === '1' || value === 'true');
    }
  }
  if (!explicit.has('debug') && options.debug === undefined) {
    options.debug =
      !['', '0', 'false', 'no', 'off'].includes((env.TANAAB_DEBUG ?? '').toLowerCase()) ||
      env.RUNNER_DEBUG === '1';
  }
  if (options.codexHome === undefined && env.CODEX_HOME !== undefined) {
    options.codexHome = env.CODEX_HOME;
  }
  let command = positionals.join(' ');
  const first = positionals[0];
  if (first === 'install' || first === 'refresh') {
    if (positionals.length > 2)
      throw new Error(positionals[0]! + ' accepts one plugin path or npm selector.');
    if (positionals[1] && explicit.has('repoRoot'))
      throw new Error('Select a positional plugin path or --repo-root, not both.');
    if (positionals[1]?.startsWith('npm:')) {
      parseNpmSelector(positionals[1]);
      options.npmSelector = positionals[1];
      delete options.repoRoot;
    } else if (positionals[1]) options.repoRoot = positionals[1];
    command = first;
  }
  if (options.marketplacePath && !['install', 'refresh'].includes(command))
    throw new Error('--marketplace-path is only valid for install or refresh.');
  const normalized = command.replace('cache ', '');
  let parsedCommand: OperationCommand | '' = '';
  if (normalized) {
    if (!operationCommand(normalized)) throw new Error('Unknown command: ' + command);
    parsedCommand = normalized;
  }
  if (!command && !options.help && !options.version && argv.length)
    throw new Error('A command is required.');
  if (options.dryRun && !['cache sync', 'install', 'refresh'].includes(command))
    throw new Error('--dry-run is only valid for cache sync, install, or refresh.');
  if (options.missingTarget && !['require-installed', 'create'].includes(options.missingTarget))
    throw new Error('Invalid --missing-target value.');
  if (options.absentCheck && !['fail', 'neutral'].includes(options.absentCheck))
    throw new Error('Invalid --absent-check value.');
  return {
    command: parsedCommand,
    ...options,
    help: options.help || (!argv.length && !options.version),
  };
}
