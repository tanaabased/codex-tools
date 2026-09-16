import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/codex-tools', import.meta.url));
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-npm-native-')));
const pkg = '@fixture/package-name';
const plugin = 'native-npm-probe';
const skill = 'native-npm-fixture';
interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
interface SmokeResult {
  ok: boolean;
  status: string;
  source: { valid: boolean | null; version?: string };
  inspection: { payload?: string };
  completed: Array<{ operation: string; skipped?: boolean }>;
}
let server: ReturnType<typeof createServer> | undefined;
const command = (
  exe: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, argv, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out: ' + exe));
    }, 60000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

async function freshSession(env: NodeJS.ProcessEnv, home: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('codex', ['app-server'], {
      env,
      cwd: home,
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
          send({ id: 2, method: 'skills/list', params: { cwds: [home], forceReload: true } });
        }
        if (data.id === 2) {
          clearTimeout(timer);
          child.kill();
          if (JSON.stringify(data.result).includes(skill)) resolve();
          else
            reject(
              new Error(
                'Fresh-session skills/list did not expose the installed fixture: ' +
                  JSON.stringify(data),
              ),
            );
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

try {
  const cert = path.join(root, 'cert.pem'),
    key = path.join(root, 'key.pem');
  const generated = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const archives = new Map<string, Buffer>();
  for (const [version, complete] of [
    ['1.2.3', true],
    ['1.3.0', true],
    ['1.3.1', true],
    ['2.0.0', false],
  ] as const) {
    const folder = path.join(root, version, 'package');
    await mkdir(path.join(folder, '.codex-plugin'), { recursive: true });
    await mkdir(path.join(folder, 'skills', skill), { recursive: true });
    await writeFile(
      path.join(folder, 'package.json'),
      JSON.stringify({
        name: pkg,
        version,
        scripts: { postinstall: 'touch ' + path.join(root, 'LIFECYCLE-RAN') },
      }),
    );
    await writeFile(
      path.join(folder, '.codex-plugin/plugin.json'),
      JSON.stringify({
        name: plugin,
        version: '7.' + (version === '1.3.1' ? '1.3.0' : version),
        skills: complete ? './skills' : './missing',
        unknownOptionalField: true,
      }),
    );
    if (version === '1.3.1') {
      await rm(path.join(folder, '.codex-plugin/plugin.json'));
      await writeFile(
        path.join(folder, 'plugin.json'),
        JSON.stringify({
          $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
          name: plugin,
          version: '7.1.3.0',
          description: 'Portable npm fixture',
          extensions: { 'com.openai': { unknownOptionalField: true } },
        }),
      );
    }
    await writeFile(
      path.join(folder, 'skills', skill, 'SKILL.md'),
      '---\nname: ' +
        skill +
        '\ndescription: Disposable native npm installation probe.\n---\n\n# Probe\n\nReturn npm-probe-ok.\n',
    );
    const tarFile = path.join(root, version + '.tgz');
    assert.equal(
      spawnSync('tar', ['-czf', tarFile, '-C', path.dirname(folder), 'package']).status,
      0,
    );
    archives.set(version, await readFile(tarFile));
  }
  let latest = '1.2.3';
  let registry = '';
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const url = new URL(req.url ?? '/', registry);
    if (url.pathname.startsWith('/tar/')) {
      const archive = archives.get(url.pathname.slice(5).replace('.tgz', ''));
      res.writeHead(archive ? 200 : 404);
      res.end(archive);
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (name !== pkg && !name.startsWith(pkg + '/')) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    const versions = Object.fromEntries(
      [...archives].map(([version, archive]) => [
        version,
        {
          name: pkg,
          version,
          dist: {
            tarball: registry + '/tar/' + version + '.tgz',
            integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
          },
        },
      ]),
    );
    const data =
      name === pkg
        ? { name: pkg, 'dist-tags': { latest, stable: '1.2.3' }, versions }
        : versions[name.slice(pkg.length + 1)];
    res.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data ?? {}));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  registry = 'https://127.0.0.1:' + (address as AddressInfo).port;
  const home = path.join(root, 'home'),
    codexHome = path.join(root, 'codex');
  await mkdir(home);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: codexHome,
    TMPDIR: root,
    NO_COLOR: '1',
    npm_config_registry: registry,
    npm_config_cafile: cert,
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_fetch_retries: '0',
    npm_config_update_notifier: 'false',
  };
  const invoke = async (
    operation: string,
    selector: string,
    args: string[] = [],
    okay = true,
  ): Promise<SmokeResult> => {
    const child = await command(cli, [operation, selector, '--json', ...args], env, home);
    const data = JSON.parse(child.stdout) as SmokeResult;
    assert.equal(data.ok, okay, child.stderr + child.stdout);
    assert.equal(child.code === 0, okay, child.stdout);
    return data;
  };
  const catalogFile = path.join(home, '.agents/plugins/marketplace.json');
  const preview = await invoke('install', 'npm:' + pkg + '@1.2.3', ['--dry-run']);
  assert.equal(preview.source.valid, null);
  await assert.rejects(lstat(catalogFile), { code: 'ENOENT' });
  // Exercise native npm sources directly before testing the wrapper.
  const nativeHome = path.join(root, 'native-home');
  await mkdir(path.join(nativeHome, '.agents/plugins'), { recursive: true });
  await mkdir(path.join(root, 'native-codex'));
  await writeFile(
    path.join(nativeHome, '.agents/plugins/marketplace.json'),
    JSON.stringify({
      name: 'compat',
      plugins: [
        {
          name: plugin,
          source: { source: 'npm', package: pkg, version: '1.2.3', registry },
        },
      ],
    }),
  );
  const nativeResult = await command(
    'codex',
    ['plugin', 'add', plugin + '@compat', '--json'],
    { ...env, HOME: nativeHome, CODEX_HOME: path.join(root, 'native-codex') },
    nativeHome,
  );
  assert.equal(nativeResult.code, 0, nativeResult.stderr);
  assert.equal(JSON.parse(nativeResult.stdout).name, plugin);
  const installed = await invoke('install', 'npm:' + pkg + '@1.2.3');
  assert.equal(installed.inspection.payload, 'verified');
  const before = await lstat(catalogFile);
  const repeated = await invoke('install', 'npm:' + pkg + '@1.2.3');
  assert.equal(repeated.completed.find((step) => step.operation === 'install')?.skipped, true);
  assert.equal((await lstat(catalogFile)).mtimeMs, before.mtimeMs);
  await invoke('install', 'npm:' + pkg + '@stable');
  await invoke('install', 'npm:' + pkg + '@~1.2.0');
  latest = '1.3.0';
  env['npm_config_@fixture:registry'] = 'https://127.0.0.1:1';
  const refreshed = await invoke('refresh', 'npm:' + pkg);
  assert.equal(refreshed.source.version, '1.2.3');
  assert.equal(refreshed.status, 'refreshed');
  delete env['npm_config_@fixture:registry'];
  await invoke('install', 'npm:' + pkg + '@latest');
  await invoke('install', 'npm:' + pkg + '@1.3.1');
  const selectedRoot = path.join(root, 'selected');
  await mkdir(selectedRoot);
  const selectedCatalog = path.join(selectedRoot, '.agents/plugins/marketplace.json');
  await invoke('install', 'npm:' + pkg + '@1.2.3', [
    '--marketplace',
    'selected',
    '--marketplace-path',
    selectedCatalog,
  ]);
  const selectedRefresh = await invoke('refresh', 'npm:' + pkg, ['--marketplace', 'selected']);
  assert.equal(selectedRefresh.source.version, '1.2.3');
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8')) as { plugins: unknown[] };
  catalog.plugins.push({
    name: 'unrelated',
    source: { source: 'npm', package: '@fixture/missing', version: '1.0.0', registry },
    note: 'preserve',
  });
  await writeFile(catalogFile, JSON.stringify(catalog));
  const preserved = await readFile(catalogFile, 'utf8');
  await invoke('install', 'npm:' + pkg + '@2.0.0', [], false);
  await invoke('install', 'npm:' + pkg + '@file:../bad', [], false);
  assert.equal(await readFile(catalogFile, 'utf8'), preserved);
  await assert.rejects(lstat(path.join(root, 'LIFECYCLE-RAN')), { code: 'ENOENT' });
  await freshSession(env, home);
  const codex = await command('codex', ['--version'], env);
  const npm = await command('npm', ['--version'], env);
  process.stdout.write(
    JSON.stringify({
      codex: codex.stdout.trim(),
      npm: npm.stdout.trim(),
      registry: 'disposable HTTPS fixture',
      nativeNpm: 'passed',
      exactTagRange: 'passed',
      idempotency: 'passed',
      pinnedRefresh: 'passed',
      incompleteAndMalformed: 'rejected',
      unrelatedCatalog: 'preserved',
      lifecycleScripts: 'not run',
      freshSessionSkillDiscovery: 'passed',
    }) + '\n',
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await rm(root, { recursive: true, force: true });
}
