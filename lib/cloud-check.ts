import inside from '../utils/inside.ts';
import { lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { parse } from 'yaml';
import { git } from './cloud-config.ts';
import type { CloudProject, CloudSkill } from './cloud-config.ts';

export interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
}
export interface CommandRecord extends FileRecord {
  resources?: FileRecord[];
}

export function fileRecord(relative: string, bytes: Buffer): FileRecord {
  return {
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const marker = '<!-- packaged-execution -->';
const readableExtensions = new Set([
  '.c',
  '.css',
  '.csv',
  '.h',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.rst',
  '.sh',
  '.svg',
  '.tsv',
  '.txt',
  '.xml',
]);
const execution = `### Packaged Command Execution

Use the installed skill directory when available. When only reader resources are available, prepare a temporary copy before running the command.

1. Find the command in \`runtime-files.json\`.
2. Copy the command and its listed resources into a fresh temporary directory, preserving their relative paths.
3. Verify each file’s byte length and SHA-256 against the inventory. Stop if a file is missing or differs.

Run the command with Bun from the current project, using the arguments and standard input specified by the skill. Read linked instructions through the skill reader.`;

export function instructions(source: string, skill: CloudSkill): string {
  if (!skill.configured) return source;
  const parts = source.split(marker);
  const enabled = skill.entries.length > 0 && skill.guidance !== 'off';
  if (skill.guidance === 'on' && (!enabled || parts.length !== 2))
    throw new Error(
      skill.dir + ': guidance on requires a bundled command and exactly one ' + marker,
    );
  if (enabled && parts.length > 2) throw new Error(skill.dir + ': repeated ' + marker);
  return parts.join(enabled ? execution : '');
}

async function checkLinks(root: string, dir: string) {
  const skill = path.join(root, dir);
  const pending = ['SKILL.md'];
  const visited = new Set<string>();
  async function target(source: string, href: string, reader: boolean) {
    const fail = (repair: string) => new Error(dir + '/' + source + ' → ' + href + ': ' + repair);
    let raw: string;
    try {
      raw = decodeURIComponent(href.split('#')[0]!);
    } catch {
      throw fail('use a valid relative URL for this file.');
    }
    const base = reader ? path.dirname(source) : '.';
    const absolute = path.resolve(skill, base, raw);
    if (path.isAbsolute(raw) || !inside(skill, absolute))
      throw fail('move the target inside the skill and update this link.');
    const info = lstatSync(absolute, { throwIfNoEntry: false });
    if (!info || !info.isFile() || (await realpath(absolute)) !== absolute)
      throw fail('link a concrete packaged file inside the skill.');
    if (!reader) return;
    const extension = path.extname(absolute).toLowerCase();
    if (!readableExtensions.has(extension))
      throw fail(
        'link an annotated Markdown file such as references/' +
          path.basename(raw) +
          '.md and include the intended output filename.',
      );
    if (extension === '.md') pending.push(path.relative(skill, absolute));
  }
  while (pending.length) {
    const source = pending.pop()!;
    if (visited.has(source)) continue;
    visited.add(source);
    const links: string[] = [];
    marked.walkTokens(marked.lexer(await readFile(path.join(skill, source), 'utf8')), (token) => {
      if (
        (token.type === 'link' || token.type === 'image') &&
        token.href &&
        !(source.startsWith('templates' + path.sep) && /^[A-Z][A-Z0-9_]*_URL$/.test(token.href)) &&
        !/^(?:#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(token.href)
      )
        links.push(token.href);
    });
    for (const link of links) await target(source, link, true);
  }
  const metadata = path.join(skill, 'agents/openai.yaml');
  if (lstatSync(metadata, { throwIfNoEntry: false })) {
    const descriptor = parse(await readFile(metadata, 'utf8'));
    for (const key of ['icon_small', 'icon_large']) {
      const icon = descriptor?.interface?.[key];
      if (icon !== undefined) {
        if (typeof icon !== 'string' || !icon)
          throw new Error(dir + ': invalid ' + key + ' in agents/openai.yaml');
        await target('agents/openai.yaml', icon, false);
      }
    }
  }
}

// packaging replaces the marker in the working tree. the index retains the original document.
function originalInstructions(project: CloudProject, document: string): string {
  const visited = new Set<string>();
  let source = document;
  while (project.tracked.has(source) && !visited.has(source)) {
    visited.add(source);
    const content = git(project.root, 'show', ':' + source);
    if (!git(project.root, 'ls-files', '--stage', '--', source).startsWith('120000 '))
      return content;
    if (path.isAbsolute(content)) break;
    source = path.join(path.dirname(source), content);
  }
  throw new Error(document + ': expected instructions from a tracked file inside the checkout.');
}

export async function checkCloudSkill(
  project: CloudProject,
  skill: CloudSkill,
  root: string,
  source?: string,
) {
  const directory = path.join(root, skill.dir);
  if ((await realpath(directory)) !== directory)
    throw new Error(skill.dir + ': package a regular directory at the expected skill path.');
  const files = await readdir(directory, { withFileTypes: true, recursive: true });
  for (const file of files)
    if (file.isSymbolicLink())
      throw new Error(
        skill.dir +
          ': materialize packaged symlink ' +
          path.relative(directory, path.join(file.parentPath, file.name)),
      );
  await checkLinks(root, skill.dir);
  const document = path.join(skill.dir, 'SKILL.md');
  const original = source ?? originalInstructions(project, document);
  if ((await readFile(path.join(root, document), 'utf8')) !== instructions(original, skill))
    throw new Error(
      document +
        ': packaged instructions differ from the original input and configured execution guidance.',
    );
  const inventoryPath = path.join(directory, 'runtime-files.json');
  if (!skill.entries.length) {
    if (lstatSync(inventoryPath, { throwIfNoEntry: false }))
      throw new Error(skill.dir + ': unexpected runtime-files.json without commands.');
    return;
  }
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  if (
    inventory.version !== project.version ||
    inventory.runtime !== 'bun' ||
    !Array.isArray(inventory.commands)
  )
    throw new Error(skill.dir + ': invalid command inventory version, runtime or commands.');
  const commands: CommandRecord[] = inventory.commands;
  const paths = commands.map((c) => c.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(skill.entries))
    throw new Error(
      skill.dir +
        ': inventory commands differ from tracked entrypoints. Expected ' +
        skill.entries.join(', '),
    );
  for (const command of commands) {
    for (const record of [command, ...(command.resources ?? [])]) {
      if (
        typeof record.path !== 'string' ||
        path.isAbsolute(record.path) ||
        path.normalize(record.path) !== record.path ||
        !inside(directory, path.join(directory, record.path)) ||
        path.dirname(record.path) !== path.dirname(command.path)
      )
        throw new Error(skill.dir + ': invalid runtime path ' + record.path);
      const bytes = await readFile(path.join(directory, record.path));
      const actual = fileRecord(record.path, bytes);
      if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256)
        throw new Error(
          skill.dir +
            '/' +
            record.path +
            ': byte length or SHA-256 differs from runtime-files.json.',
        );
    }
  }
}
