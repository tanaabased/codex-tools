import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function put(root, name, content) {
  const target = join(root, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
}

export async function fixture(consumer = 'agentbox') {
  const root = await mkdtemp(join(tmpdir(), 'codex-tools-validation-'));
  const manifest = JSON.parse(
    await readFile(new URL('./fixtures/validation/' + consumer + '.json', import.meta.url), 'utf8'),
  );
  await put(root, '.codex-plugin/plugin.json', manifest);
  for (const field of ['composerIcon', 'logo'])
    await put(root, manifest.interface[field], 'fixture asset');
  const names = [
    ...new Set(
      manifest.interface.defaultPrompt.flatMap((p) =>
        [...p.matchAll(/\$([a-z][a-z0-9-]*)/g)].map((m) => m[1]),
      ),
    ),
  ];
  for (const name of names)
    await put(
      root,
      'skills/' + name + '/SKILL.md',
      '---\nname: ' + name + '\ndescription: Minimal standalone skill.\n---\n\n# Skill\n',
    );
  if (manifest.mcpServers) await put(root, manifest.mcpServers, { mcpServers: {} });
  return { root, manifest, names };
}
