import { spawn } from 'node:child_process';

import { asError } from '../utils/errors.ts';

export const supportedCodexVersion = '0.154.0';
export const supportedCodexFamily = supportedCodexVersion.replace(/\.\d+$/, '.x');
const supportedVersion = new RegExp(
  '^codex-cli ' + supportedCodexFamily.replaceAll('.', '\\.').replace('x', '\\d+') + '$',
);

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
}

/** injectable asynchronous native-command boundary used by install and refresh. */
export type NativeRunner = (
  argv: readonly string[],
  options?: NativeOptions,
) => Promise<NativeResult>;

/** runs one bounded native codex command without interpreting its response. */
export async function runNative(
  argv: readonly string[],
  { env, cwd, executable = 'codex', timeoutMs = 30000 }: NativeOptions = {},
): Promise<NativeResult> {
  return new Promise((resolve) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, [...argv], {
      env,
      cwd,
      detached: grouped,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* the process may have exited as its deadline expired. */
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ argv, exitCode: 2, stdout, stderr, error: asError(error).message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        argv,
        exitCode: code ?? 1,
        ...(signal === null ? {} : { signal }),
        stdout,
        stderr,
      });
    });
  });
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
  if (!supportedVersion.test(version))
    throw new Error(
      unsupportedMessage ??
        'Supported native contract is Codex ' + supportedCodexFamily + '; found ' + version,
    );
  return version;
}
