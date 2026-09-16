import { build } from 'bun';
import { chmod, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
for (const [entrypoint, output] of [
  ['bin/codex-tools.js', 'codex-tools'],
  ['lib/index.js', 'index.js'],
]) {
  const result = await build({
    entrypoints: [entrypoint],
    outdir: 'dist',
    naming: output,
    target: 'bun',
  });
  if (!result.success) throw new AggregateError(result.logs, 'Build failed');
}
await chmod('dist/codex-tools', 0o755);
