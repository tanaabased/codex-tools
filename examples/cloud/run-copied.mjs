import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [skill, destination] = process.argv.slice(2);
const { commands } = JSON.parse(await readFile(path.join(skill, 'runtime-files.json'), 'utf8'));
const [command] = commands;
assert.equal(command.path, 'scripts/write.js');
assert.equal(command.resources.length, 1);
for (const record of [command, ...command.resources]) {
  const bytes = await readFile(path.join(skill, record.path));
  assert.equal(bytes.length, record.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  await mkdir(path.dirname(path.join(destination, record.path)), { recursive: true });
  await writeFile(path.join(destination, record.path), bytes);
}
process.stdout.write(execFileSync('bun', [command.path], { cwd: destination }));
