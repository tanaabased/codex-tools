import { spawn } from 'node:child_process';

const supportedVersion = /^codex-cli 0\.153\.\d+$/;

export async function runNative(argv, { env, cwd, executable = 'codex', timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, argv, {
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
      resolve({ argv, exitCode: 2, stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ argv, exitCode: code ?? 1, signal, stdout, stderr });
    });
  });
}

export function readNativeResult(
  child,
  { json = true, failureMessage, invalidJsonMessage = 'Native Codex returned invalid JSON.' } = {},
) {
  if (child.exitCode !== 0)
    throw new Error(
      failureMessage ??
        child.error ??
        (String(child.stderr ?? '').trim() || 'Native Codex command failed.'),
    );
  const stdout = String(child.stdout ?? '');
  if (!json) return stdout.trim();
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(invalidJsonMessage);
  }
}

export function assertSupportedCodexVersion(version, { unsupportedMessage } = {}) {
  if (!supportedVersion.test(version))
    throw new Error(
      unsupportedMessage ?? 'Supported native contract is Codex 0.153.x; found ' + version,
    );
  return version;
}
