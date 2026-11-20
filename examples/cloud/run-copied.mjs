import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [skill, destination] = process.argv.slice(2);
const { version, commands } = JSON.parse(
  await readFile(path.join(skill, 'runtime-files.json'), 'utf8'),
);
assert.equal(version, '1.2.4');
assert.deepEqual(commands.map((command) => command.path).sort(), [
  'scripts/icons.mjs',
  'scripts/write.js',
]);
for (const command of commands) {
  const directory = path.join(destination, path.basename(command.path));
  const resources = command.resources ?? [];
  assert.equal(resources.length, command.path === 'scripts/write.js' ? 1 : 0);
  for (const record of [command, ...resources]) {
    const bytes = await readFile(path.join(skill, record.path));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    const copy = path.join(directory, record.path);
    await mkdir(path.dirname(copy), { recursive: true });
    await writeFile(copy, bytes);
  }
  const output = execFileSync('bun', [path.join(directory, command.path)], {
    cwd: destination,
    encoding: 'utf8',
  });
  if (command.path === 'scripts/write.js') process.stdout.write(output);
  else {
    assert.deepEqual(JSON.parse(output), [
      await readFile(path.join(skill, 'assets/icon.svg'), 'utf8'),
      await readFile(path.join(skill, 'assets/icon.png'), 'base64'),
    ]);
  }
}
