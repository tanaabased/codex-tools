import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const [option, ...extra] = process.argv.slice(2);
if (extra.length || (option && !/^--(?:pack-destination|tarball)=.+$/.test(option)))
  throw new Error('Usage: check:package [--pack-destination=directory | --tarball=file]');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-package-')));
try {
  const env = { ...process.env, TMPDIR: root, npm_config_cache: path.join(root, 'npm-cache') };
  let tarball = option?.startsWith('--tarball=')
    ? path.resolve(repo, option.slice('--tarball='.length))
    : undefined;
  if (!tarball) {
    const destination = option
      ? path.resolve(repo, option.slice('--pack-destination='.length))
      : root;
    await mkdir(destination, { recursive: true });
    const [packed] = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', destination],
        { cwd: repo, env, encoding: 'utf8' },
      ),
    ) as Array<{ filename: string }>;
    if (!packed) throw new Error('npm pack returned no tarball');
    tarball = path.join(destination, packed.filename);
  }
  const child = spawnSync(
    process.execPath,
    [
      'run',
      'leia',
      'examples/package/README.md',
      '--shell',
      'bash',
      '--retry',
      '0',
      '--timeout',
      '120',
    ],
    { cwd: repo, env: { ...env, CODEX_TOOLS_PACKAGE: tarball }, stdio: 'inherit' },
  );
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
