import { parseNpmSelector } from './npm-selector.js';

const strings = new Map([
  ['repo-root', 'repoRoot'],
  ['cache-path', 'cachePathOverride'],
  ['codex-home', 'codexHome'],
  ['marketplace', 'marketplace'],
  ['marketplace-path', 'marketplacePath'],
  ['missing-target', 'missingTarget'],
  ['absent-check', 'absentCheck'],
]);
const booleans = new Map([
  ['help', 'help'],
  ['version', 'version'],
  ['json', 'json'],
  ['debug', 'debug'],
  ['dry-run', 'dryRun'],
]);

export function parseArgs(argv, env = process.env) {
  const options = {};
  const positionals = [];
  const explicit = new Set();
  const aliases = { '-h': '--help', '-V': '--version', '-v': '--version' };
  for (let i = 0; i < argv.length; i++) {
    const arg = aliases[argv[i]] ?? argv[i];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const [flag, ...parts] = arg.slice(2).split('=');
    const value = parts.length ? parts.join('=') : undefined;
    const negative = flag.startsWith('no-');
    const boolean = booleans.get(negative ? flag.slice(3) : flag);
    if (arg.startsWith('--') && boolean) {
      if (value !== undefined) throw new Error('Flag --' + flag + ' does not accept a value.');
      if (explicit.has(boolean)) throw new Error('Repeated option: --' + flag);
      explicit.add(boolean);
      options[boolean] = !negative;
    } else if (arg.startsWith('--') && strings.has(flag)) {
      const key = strings.get(flag);
      if (explicit.has(key)) throw new Error('Repeated option: --' + flag);
      const next = value ?? argv[++i];
      if (!next || next.startsWith('-')) throw new Error('Flag --' + flag + ' requires a value.');
      explicit.add(key);
      options[key] = next;
    } else throw new Error('Unknown option: ' + arg);
  }
  for (const [flag, key] of strings) {
    const value = env['CODEX_TOOLS_' + flag.replaceAll('-', '_').toUpperCase()];
    if (!explicit.has(key) && value) options[key] = value;
  }
  for (const [flag, key] of booleans) {
    if (['help', 'version'].includes(key) || explicit.has(key)) continue;
    const value = env['CODEX_TOOLS_' + flag.replaceAll('-', '_').toUpperCase()];
    if (value !== undefined) {
      if (!['1', '0', 'true', 'false'].includes(value))
        throw new Error('Invalid boolean environment value for --' + flag);
      options[key] = value === '1' || value === 'true';
    }
  }
  if (!explicit.has('debug') && options.debug === undefined) {
    options.debug =
      !['', '0', 'false', 'no', 'off'].includes((env.TANAAB_DEBUG ?? '').toLowerCase()) ||
      env.RUNNER_DEBUG === '1';
  }
  options.codexHome ??= env.CODEX_HOME;
  let command = positionals.join(' ');
  if (['install', 'refresh'].includes(positionals[0])) {
    if (positionals.length > 2)
      throw new Error(positionals[0] + ' accepts one plugin path or npm selector.');
    if (positionals[1] && explicit.has('repoRoot'))
      throw new Error('Select a positional plugin path or --repo-root, not both.');
    if (positionals[1]?.startsWith('npm:')) {
      parseNpmSelector(positionals[1]);
      options.npmSelector = positionals[1];
      delete options.repoRoot;
    } else if (positionals[1]) options.repoRoot = positionals[1];
    command = positionals[0];
  }
  if (options.marketplacePath && !['install', 'refresh'].includes(command))
    throw new Error('--marketplace-path is only valid for install or refresh.');
  const allowed = ['cache check', 'cache sync', 'status', 'doctor', 'install', 'refresh'];
  if (command && !allowed.includes(command)) throw new Error('Unknown command: ' + command);
  if (!command && !options.help && !options.version && argv.length)
    throw new Error('A command is required.');
  if (options.dryRun && !['cache sync', 'install', 'refresh'].includes(command))
    throw new Error('--dry-run is only valid for cache sync, install, or refresh.');
  if (options.missingTarget && !['require-installed', 'create'].includes(options.missingTarget))
    throw new Error('Invalid --missing-target value.');
  if (options.absentCheck && !['fail', 'neutral'].includes(options.absentCheck))
    throw new Error('Invalid --absent-check value.');
  return {
    command: command.replace('cache ', ''),
    ...options,
    help: options.help || (!argv.length && !options.version),
  };
}
