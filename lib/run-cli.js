import packageJson from '../package.json';
import { parseArgs } from '../utils/parse-args.js';
import { renderHelp } from './help.js';
import { styles, renderResult } from './presentation.js';
import { runOperation } from './operations.js';

let SCRIPT_VERSION;
if (!SCRIPT_VERSION) SCRIPT_VERSION = packageJson.version;

export async function runCLI(
  argv = process.argv.slice(2),
  { env = process.env, stdout = process.stdout, stderr = process.stderr } = {},
) {
  let options;
  try {
    options = parseArgs(argv, env);
    if (options.help || options.version) {
      const value = options.help ? renderHelp(styles(stdout, options.json)) : SCRIPT_VERSION;
      stdout.write(
        (options.json
          ? JSON.stringify(options.help ? { help: value } : { version: value })
          : value) + '\n',
      );
      return 0;
    }
    if (options.debug)
      stderr.write(
        'debug: ' +
          JSON.stringify({
            command: options.command,
            repoRoot: options.repoRoot,
            cachePath: options.cachePathOverride,
          }) +
          '\n',
      );
    const result = await runOperation(options.command, options);
    stdout.write((options.json ? JSON.stringify(result) : renderResult(result)) + '\n');
    if (result.command === 'validate' && !options.json) {
      for (const check of [result.dependency, result.upstream, ...result.repository]) {
        if (check.stderr) stderr.write(check.stderr);
        if (check.error) stderr.write(check.error + '\n');
      }
    }
    if (!result.ok && !options.json)
      stderr.write('error: ' + (result.issue ?? 'cache drift detected') + '\n');
    return result.status === 'dependency_error' ? 2 : result.ok ? 0 : 1;
  } catch (error) {
    const json =
      options?.json ??
      ((argv.includes('--json') || ['1', 'true'].includes(env.CODEX_TOOLS_JSON)) &&
        !argv.includes('--no-json'));
    if (json)
      stdout.write(
        JSON.stringify({
          ok: false,
          status: 'error',
          error: error.message,
          ...(error.source ? { source: error.source } : {}),
        }) + '\n',
      );
    stderr.write('error: ' + error.message + '\n');
    if (options?.debug) stderr.write(String(error.stack) + '\n');
    return 2;
  }
}
