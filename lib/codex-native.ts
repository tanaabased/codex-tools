import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { asError } from '../utils/errors.ts';

export const supportedCodexVersion = '0.154.0';
const supportedVersion = 'codex-cli ' + supportedCodexVersion;

export type NativeRecord = Record<string, unknown>;

export interface NativePluginInspection {
  name: string;
  pluginId: string;
  version: string;
  installedPath: string;
}

/** captured result from one bounded native codex or npm subprocess. */
export interface NativeResult {
  argv: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
  error?: string;
}

/** environment, working directory, executable, and deadline for a native command. */
export interface NativeOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  executable?: string;
  timeoutMs?: number;
  pluginInstall?: { marketplacePath: string; pluginName: string };
}

export const stagedInstallArgv = ['app-server'] as const;

/** injectable asynchronous native-command boundary used by install and refresh. */
export type NativeRunner = (
  argv: readonly string[],
  options?: NativeOptions,
) => Promise<NativeResult>;

/** runs one bounded native codex command without interpreting its response. */
export async function runNative(
  argv: readonly string[],
  { env, cwd, executable, timeoutMs = 30000, pluginInstall }: NativeOptions = {},
): Promise<NativeResult> {
  if (!executable) throw new Error('Native executable is required.');
  return new Promise((resolve) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, [...argv], {
      env,
      cwd,
      detached: grouped,
      stdio: [pluginInstall ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let response: string | undefined;
    let requestError: string | undefined;
    const timer = setTimeout(() => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* the process may have exited as its deadline expired. */
      }
    }, timeoutMs);
    if (pluginInstall && child.stdin) {
      const input = child.stdin;
      const send = (value: NativeRecord) => input.write(JSON.stringify(value) + '\n');
      input.on('error', (error) => {
        requestError ??= error.message;
      });
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'codex-tools', version: '1' } },
      });
      const lines = createInterface({ input: child.stdout! });
      lines.on('line', (line) => {
        if (input.writableEnded) return;
        try {
          const message = JSON.parse(line) as NativeRecord;
          if (message.id === 1 && message.result) {
            send({ method: 'initialized' });
            send({ id: 2, method: 'plugin/install', params: pluginInstall });
          } else if (message.id === 1 || message.id === 2) {
            if (message.result) response = JSON.stringify(message.result);
            else requestError = 'Codex app-server rejected the local plugin install request.';
            input.end();
          }
        } catch {
          requestError = 'Codex app-server returned an invalid response.';
          input.end();
        }
      });
    } else {
      child.stdout!.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.stderr!.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ argv, exitCode: 2, stdout, stderr, error: asError(error).message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (pluginInstall && response === undefined)
        requestError ??= 'Codex app-server exited without confirming the local plugin install.';
      resolve({
        argv,
        exitCode: requestError ? code || 2 : (code ?? 1),
        ...(signal === null ? {} : { signal }),
        stdout: response ?? stdout,
        stderr,
        ...(requestError === undefined ? {} : { error: requestError }),
      });
    });
  });
}

export function readStagedInstall(child: NativeResult): void {
  const result = readNativeResult(child) as NativeRecord | null;
  if (!result || !['ON_USE', 'ON_INSTALL'].includes(String(result.authPolicy)))
    throw new Error('Codex app-server did not confirm the local plugin install.');
}

interface ReadNativeOptions {
  json?: boolean;
  failureMessage?: string;
  invalidJsonMessage?: string;
}

export function readNativeResult(
  child: NativeResult,
  options: ReadNativeOptions & { json: false },
): string;
export function readNativeResult(child: NativeResult, options?: ReadNativeOptions): unknown;
export function readNativeResult(
  child: NativeResult,
  {
    json = true,
    failureMessage,
    invalidJsonMessage = 'Native Codex returned invalid JSON.',
  }: ReadNativeOptions = {},
): unknown {
  if (child.exitCode !== 0)
    throw new Error(
      failureMessage ??
        child.error ??
        (String(child.stderr ?? '').trim() || 'Native Codex command failed.'),
    );
  const stdout = String(child.stdout ?? '');
  if (!json) return stdout.trim();
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(invalidJsonMessage);
  }
}

/** reads the list envelopes returned by the supported native codex contract. */
export function readNativeRows(
  value: unknown,
  field: 'installed' | 'marketplaces',
): NativeRecord[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as NativeRecord)[field])
  ) {
    throw new Error(
      `Unsupported native ${field === 'installed' ? 'installation' : 'marketplace'} readback.`,
    );
  }
  const rows = (value as NativeRecord)[field] as unknown[];
  const identity = field === 'installed' ? 'pluginId' : 'name';
  if (
    rows.some(
      (row) =>
        typeof row !== 'object' ||
        row === null ||
        typeof (row as NativeRecord)[identity] !== 'string',
    )
  ) {
    throw new Error(
      `Unsupported native ${field === 'installed' ? 'installation' : 'marketplace'} readback.`,
    );
  }
  return rows as NativeRecord[];
}

/** reads the plugin identity returned by native npm acquisition. */
export function readNativePluginInspection(value: unknown): NativePluginInspection {
  if (typeof value !== 'object' || value === null)
    throw new Error('Native inspection returned an unexpected package identity or path.');
  const data = value as NativeRecord;
  if (
    typeof data.name !== 'string' ||
    !data.name ||
    typeof data.pluginId !== 'string' ||
    !data.pluginId ||
    typeof data.version !== 'string' ||
    !data.version ||
    typeof data.installedPath !== 'string' ||
    !data.installedPath
  )
    throw new Error('Native inspection returned an unexpected package identity or path.');
  return {
    name: data.name,
    pluginId: data.pluginId,
    version: data.version,
    installedPath: data.installedPath,
  };
}

/** enforces the native response contract supported by this package version. */
export function assertSupportedCodexVersion(
  version: string,
  { unsupportedMessage }: { unsupportedMessage?: string } = {},
): string {
  if (version !== supportedVersion)
    throw new Error(
      unsupportedMessage ??
        'Supported native contract is Codex ' + supportedCodexVersion + '; found ' + version,
    );
  return version;
}
