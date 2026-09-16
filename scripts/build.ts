import { build } from 'bun';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { declarations } from './declarations.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = path.join(root, 'dist');

async function bundle(
  entrypoint: string,
  destination: string,
  format: 'esm' | 'cjs',
): Promise<void> {
  const result = await build({
    entrypoints: [path.join(root, entrypoint)],
    outdir: path.dirname(path.join(root, destination)),
    naming: path.basename(destination),
    target: 'node',
    format,
    packages: 'bundle',
  });
  if (!result.success) throw new AggregateError(result.logs, `${format} build failed`);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(path.join(outdir, 'esm'), { recursive: true });
await mkdir(path.join(outdir, 'cjs'), { recursive: true });

await bundle('lib/index.ts', 'dist/esm/index.js', 'esm');
await bundle('lib/index.ts', 'dist/cjs/index.cjs', 'cjs');
await bundle('bin/codex-tools.ts', 'dist/codex-tools', 'esm');

const cli = path.join(outdir, 'codex-tools');
const body = (await readFile(cli, 'utf8')).replace(/^#![^\n]*\n/, '');
await writeFile(cli, `#!/usr/bin/env node\n${body}`);
await chmod(cli, 0o755);

await declarations(root);
process.stdout.write('Built Node CLI plus typed ESM and CommonJS distributions.\n');
