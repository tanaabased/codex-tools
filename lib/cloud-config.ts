import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CloudSkill {
  dir: string;
  configured: boolean;
  entries: string[];
  copies: string[];
  symlinks: boolean;
  guidance: 'on' | 'auto' | 'off';
}

export interface CloudProject {
  root: string;
  tracked: Set<string>;
  version: string;
  skills: CloudSkill[];
}

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function select(files: Iterable<string>, input: unknown, label: string): string[] {
  const patterns: unknown[] = Array.isArray(input) ? input : [input];
  const include: string[] = [],
    exclude: string[] = [];
  for (const item of patterns) {
    if (typeof item !== 'string' || !item || item === '!')
      throw new Error(label + ' expects glob strings.');
    if (item.startsWith('!')) exclude.push(item.slice(1));
    else include.push(item);
  }
  return [...files]
    .filter(
      (file) =>
        include.some((g) => path.matchesGlob(file, g)) &&
        !exclude.some((g) => path.matchesGlob(file, g)),
    )
    .sort();
}

async function loadConfig(file: string): Promise<Record<string, unknown>> {
  if ((await realpath(file)) !== file) throw new Error('Expected a regular config path: ' + file);
  const config: unknown = (await import(pathToFileURL(file).href)).default;
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Expected a default-exported config object in ' + file);
  return config as Record<string, unknown>;
}

export async function cloudProject(explicit?: string): Promise<CloudProject> {
  const start = await realpath(explicit ? path.dirname(path.resolve(explicit)) : process.cwd());
  const root = await realpath(git(start, 'rev-parse', '--show-toplevel').trimEnd());
  const ancestors = [];
  for (let dir = start; inside(root, dir); dir = path.dirname(dir)) {
    ancestors.push(dir);
    if (dir === root) break;
  }
  const tracked = new Set(git(root, 'ls-files', '--cached', '-z').split('\0').filter(Boolean));
  const isSkill = (dir: string) => tracked.has(path.relative(root, path.join(dir, 'SKILL.md')));
  let file = explicit && path.join(start, path.basename(explicit));
  if (!file) {
    const skill = ancestors.find(
      (dir) => isSkill(dir) && existsSync(path.join(dir, 'build.config.js')),
    );
    const cloud = ancestors.find((dir) => existsSync(path.join(dir, 'cloud.config.js')));
    if (skill) file = path.join(skill, 'build.config.js');
    else if (cloud) file = path.join(cloud, 'cloud.config.js');
    else
      throw new Error(
        'No build.config.js or cloud.config.js found through ' +
          root +
          '. Pass an explicit config path.',
      );
  }
  const config = await loadConfig(file);
  const configDir = path.dirname(file);
  const repository = 'skills' in config;
  if (!repository && !isSkill(configDir))
    throw new Error(file + ' must declare skills or sit beside a tracked SKILL.md.');
  if (repository && Object.keys(config).some((k) => k !== 'skills'))
    throw new Error(file + ' mixes skill discovery with unsupported options.');
  const documents = repository
    ? select(
        [...tracked].filter((f) => path.basename(f) === 'SKILL.md'),
        config.skills,
        'skills',
      )
    : [path.relative(root, path.join(configDir, 'SKILL.md'))];
  if (!documents.length) throw new Error('No tracked SKILL.md matched ' + file);
  const skills: CloudSkill[] = [];
  for (const document of documents) {
    const dir = path.dirname(document);
    const standard = path.join(dir, 'build.config.js');
    const configured = !repository || tracked.has(standard);
    const build = !repository
      ? config
      : configured
        ? await loadConfig(path.join(root, standard))
        : {};
    for (const key of Object.keys(build)) {
      if (!['entrypoints', 'copy', 'symlinks', 'guidance'].includes(key))
        throw new Error(document + ': unknown build option ' + key);
    }
    const { symlinks = true, guidance = 'auto' } = build;
    if (
      typeof symlinks !== 'boolean' ||
      (guidance !== 'on' && guidance !== 'off' && guidance !== 'auto')
    )
      throw new Error(document + ': invalid symlinks or guidance setting.');
    const local = [...tracked].filter((f) => inside(dir, f)).map((f) => path.relative(dir, f));
    const entries = select(local, build.entrypoints ?? [], 'entrypoints');
    if (
      build.entrypoints &&
      (!Array.isArray(build.entrypoints) || build.entrypoints.length) &&
      !entries.length
    )
      throw new Error(document + ': no tracked entrypoints matched.');
    skills.push({
      dir,
      configured,
      entries,
      copies: select(tracked, build.copy ?? [], 'copy'),
      symlinks,
      guidance,
    });
  }
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !version)
    throw new Error('Expected a version in package.json.');
  return { root, tracked, version, skills };
}
