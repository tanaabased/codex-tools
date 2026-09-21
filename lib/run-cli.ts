import { asError } from '../utils/errors.ts';
import packageJson from '../package.json';
import { parseArgs } from '../utils/parse-args.ts';
import { renderHelp } from './help.ts';
import { renderResult, styles } from './presentation.ts';
import { runOperation } from './operations.ts';

const SCRIPT_VERSION: string = packageJson.version;

/** minimal writable stream surface accepted by the cli wrapper. */
export interface OutputStream {
  write(value: string): unknown;
  isTTY?: boolean;
}

/** injectable process boundaries used by programmatic cli callers and tests. */
export interface CLIRuntime {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputStream;
  stderr?: OutputStream;
}

/**
 * runs the cli against injectable environment and output streams.
 *
 * the function writes successful results, help, versions, and json failures to stdout; diagnostics
 * remain on stderr. it returns the intended process exit code without assigning `process.exitCode`.
 * the selected operation may read or modify plugin, marketplace, cache, and native codex state as
 * documented by its options.
 *
 * @param argv cli arguments without the executable name.
 * @param runtime optional environment and output streams; omitted values use the current process.
 * @returns `0` for success, `1` for ordinary operation failure, `2` for parsing or thrown errors,
 * or a preserved native child exit code.
 */
export async function runCLI(
  argv: readonly string[] = process.argv.slice(2),
  { env = process.env, stdout = process.stdout, stderr = process.stderr }: CLIRuntime = {},
): Promise<number> {
  let options: ReturnType<typeof parseArgs> | undefined;
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
    if (!options.command) throw new Error('A command is required.');
    const result = await runOperation(options.command, options, { env });
    stdout.write((options.json ? JSON.stringify(result) : renderResult(result)) + '\n');
    if (!result.ok && !options.json)
      stderr.write('error: ' + (result.issue ?? 'cache drift detected') + '\n');
    const exitCode =
      'exitCode' in result && typeof result.exitCode === 'number' ? result.exitCode : 1;
    return result.ok ? 0 : exitCode;
  } catch (error) {
    const failure = asError(error);
    const json =
      options?.json ??
      ((argv.includes('--json') || ['1', 'true'].includes(env.CODEX_TOOLS_JSON ?? '')) &&
        !argv.includes('--no-json'));
    if (json)
      stdout.write(
        JSON.stringify({
          ok: false,
          status: 'error',
          error: failure.message,
          ...(failure.source ? { source: failure.source } : {}),
        }) + '\n',
      );
    stderr.write('error: ' + failure.message + '\n');
    if (options?.debug) stderr.write(String(failure.stack) + '\n');
    return 2;
  }
}
