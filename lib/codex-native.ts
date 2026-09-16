import { spawn } from 'node:child_process';

import { asError } from '../utils/errors.ts';

const supportedVersion = /^codex-cli 0\.153\.\d+$/;

export interface NativeResult {
  argv: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
  error?: string;
}

export interface NativeOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  executable?: string;
  timeoutMs?: number;
}

export type NativeRunner = (
  argv: readonly string[],
  options?: NativeOptions,
) => Promise<NativeResult>;

/** Runs one bounded native Codex command without interpreting its response. */
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
        /* The process may have exited as its deadline expired. */
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

/** Enforces the native response contract supported by this package version. */
export function assertSupportedCodexVersion(
  version: string,
  { unsupportedMessage }: { unsupportedMessage?: string } = {},
): string {
  if (!supportedVersion.test(version))
    throw new Error(
      unsupportedMessage ?? 'Supported native contract is Codex 0.153.x; found ' + version,
    );
  return version;
}
