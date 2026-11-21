import { realpath } from 'node:fs/promises';
import { cloudProject } from './cloud-config.ts';
import { checkCloudSkill } from './cloud-check.ts';
import { packageCloudSkills } from './package-cloud-skills.ts';
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
 * runs the CLI, writing output to stdout and diagnostics to stderr. the caller controls
 * `process.exitCode`.
 *
 * @example
 * run the CLI from a script that forwards the exit code.
 *
 * ```js
 * import { runCLI } from '@tanaab/codex-tools';
 *
 * process.exitCode = await runCLI(['status', '--repo-root', '/path/to/plugin', '--json']);
 * ```
 *
 * @param argv arguments after the executable name. defaults to the current process arguments.
 * @param runtime override the current process environment or streams.
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
    if (!options.command) throw new Error('A command is required.');
    const debug = (fields: Record<string, string | undefined>) => {
      if (options?.debug)
        stderr.write('debug: ' + JSON.stringify({ command: options.command, ...fields }) + '\n');
    };
    if (options.command === 'cloud package' || options.command === 'cloud verify') {
      const project = await cloudProject(options.configPath, options.command);
      const verifying = options.command === 'cloud verify';
      const root = verifying ? await realpath(options.packageDirectory!) : project.root;
      debug({
        repoRoot: project.root,
        configPath: project.configPath,
        packageDirectory: verifying ? root : undefined,
      });
      let skills: string[];
      if (verifying) {
        for (const skill of project.skills) await checkCloudSkill(project, skill, root);
        skills = project.skills.map((skill) => skill.dir);
      } else skills = await packageCloudSkills(project, env);
      const status = verifying ? 'verified' : 'packaged';
      const style = styles(stdout, options.json);
      stdout.write(
        (options.json
          ? JSON.stringify({ ok: true, status, skills })
          : style.success(status) +
            ' ' +
            skills.length +
            ' skill(s): ' +
            skills.map((skill) => style.target(skill)).join(', ')) + '\n',
      );
      return 0;
    }
    debug({ repoRoot: options.repoRoot, cachePath: options.cachePathOverride });
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
    stderr.write(styles(stderr, json).error('error') + ': ' + failure.message + '\n');
    if (options?.debug) stderr.write(String(failure.stack) + '\n');
    return 2;
  }
}
