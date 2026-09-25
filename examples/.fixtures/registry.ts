import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await realpath(process.argv[2]!);
const pkg = '@fixture/package-name';
const plugin = 'native-npm-probe';
const skill = 'native-npm-fixture';

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
await writeFile(path.join(root, 'latest'), '1.2.3');
let registry = '';
const server = createServer(
  { key: await readFile(key), cert: await readFile(cert) },
  (req, res) => {
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
        ? {
            name: pkg,
            'dist-tags': {
              latest: readFileSync(path.join(root, 'latest'), 'utf8').trim(),
              stable: '1.2.3',
            },
            versions,
          }
        : versions[name.slice(pkg.length + 1)];
    res.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data ?? {}));
  },
);
await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
registry = 'https://127.0.0.1:' + (address as AddressInfo).port;

await writeFile(path.join(root, 'registry-url'), registry);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
