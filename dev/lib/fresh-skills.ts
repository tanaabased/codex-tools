import { spawn } from 'node:child_process';

export async function freshSkills(
  env: NodeJS.ProcessEnv,
  cwd: string,
  expected: readonly string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('codex', ['app-server'], {
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Fresh-session skill discovery timed out.'));
    }, 20000);
    child.stderr.resume();
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let data: { id?: number; result?: unknown };
        try {
          data = JSON.parse(line) as { id?: number; result?: unknown };
        } catch {
          continue;
        }
        if (data.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'skills/list', params: { cwds: [cwd], forceReload: true } });
        }
        if (data.id === 2) {
          clearTimeout(timer);
          child.kill();
          const result = JSON.stringify(data.result);
          const missing = expected.filter((skill) => !result.includes(skill));
          if (!missing.length) resolve();
          else reject(new Error('Fresh-session skills/list omitted: ' + missing.join(', ')));
        }
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
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
