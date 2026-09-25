import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';

type AppServer = EventEmitter &
  Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'kill'>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discoveredSkills(result: unknown, cwd: string): Set<string> {
  if (!record(result) || !Array.isArray(result.data))
    throw new Error('Malformed fresh-session skills/list response.');
  const entries = result.data.filter(
    (entry: unknown): entry is Record<string, unknown> => record(entry) && entry.cwd === cwd,
  );
  const entry: Record<string, unknown> | undefined = entries[0];
  if (entries.length !== 1 || !Array.isArray(entry?.skills))
    throw new Error('Fresh-session skills/list omitted the requested directory.');
  const names = new Set<string>();
  for (const skill of entry.skills as unknown[]) {
    if (!record(skill) || typeof skill.name !== 'string' || typeof skill.enabled !== 'boolean')
      throw new Error('Malformed fresh-session skill record.');
    if (skill.enabled) names.add(skill.name);
  }
  return names;
}

export async function freshSkills(
  env: NodeJS.ProcessEnv,
  cwd: string,
  expected: readonly string[],
  start: () => AppServer = () =>
    spawn('codex', ['app-server'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = start();
    let buffer = '';
    let settled = false;
    const finish = (error?: Error, signal: NodeJS.Signals = 'SIGTERM') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill(signal);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error('Fresh-session skill discovery timed out.'), 'SIGKILL');
    }, 20000);
    child.stderr.resume();
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let data: unknown;
        try {
          data = JSON.parse(line) as unknown;
        } catch {
          finish(new Error('Malformed fresh-session app-server response.'));
          return;
        }
        if (settled) return;
        if (!record(data) || (data.id !== 1 && data.id !== 2)) continue;
        if ('error' in data || !record(data.result)) {
          finish(new Error('Fresh-session app-server request failed: ' + data.id));
          return;
        }
        if (data.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'skills/list', params: { cwds: [cwd], forceReload: true } });
        }
        if (data.id === 2) {
          try {
            const names = discoveredSkills(data.result, cwd);
            const missing = expected.filter((skill) => !names.has(skill));
            if (missing.length)
              throw new Error('Fresh-session skills/list omitted: ' + missing.join(', '));
            finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    });
    child.on('error', finish);
    child.stdin.on('error', finish);
    child.on('close', () => finish(new Error('Fresh-session app-server exited before discovery.')));
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex-tools-native-test', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

if (import.meta.main) {
  const [cwd, ...expected] = process.argv.slice(2);
  if (!cwd || !expected.length) throw new Error('expected a directory and exact skill names');
  await freshSkills(process.env, cwd, expected);
  process.stdout.write('Discovered enabled skills: ' + expected.join(', ') + '\n');
}
