import inside from '../utils/inside.ts';
import { lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire, isBuiltin } from 'node:module';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CloudProject, CloudSkill } from './cloud-config.ts';
import { checkCloudSkill, fileRecord, instructions } from './cloud-check.ts';
import type { CommandRecord, FileRecord } from './cloud-check.ts';

const template = 'templates/packaged-command-execution.md';
interface Output {
  path: string;
  bytes: Buffer;
  mode?: number;
  asset?: boolean;
}
interface BuildInput {
  imports: { path: string; kind: string; external?: boolean }[];
}

function runtimeBuiltin(name: string) {
  return isBuiltin(name) || name === 'bun' || name.startsWith('bun:');
}

async function bundle(
  project: CloudProject,
  skill: CloudSkill,
  entry: string,
  env: NodeJS.ProcessEnv,
) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'codex-tools-bundle-'));
  const out = path.join(scratch, 'out');
  const meta = path.join(scratch, 'meta.json');
  try {
    execFileSync(
      'bun',
      [
        '--no-install',
        'build',
        './' + path.join(skill.dir, entry),
        '--format=esm',
        '--target=bun',
        '--packages=bundle',
        '--entry-naming=' + path.basename(entry),
        '--outdir',
        out,
        '--metafile=' + meta,
      ],
      { cwd: project.root, env, stdio: 'pipe' },
    );
    const { inputs }: { inputs: Record<string, BuildInput> } = JSON.parse(
      await readFile(meta, 'utf8'),
    );
    const sources = new Set(Object.keys(inputs));
    for (const [name, input] of Object.entries(inputs)) {
      for (const dep of input.imports) {
        if (!dep.external || runtimeBuiltin(dep.path)) continue;
        // bun can rewrite require calls to aliases that an import scan cannot identify.
        if (dep.kind !== 'import-statement')
          throw new Error(entry + ': bundle has an external dependency: ' + dep.path);
        // bun reports local macro modules as external imports.
        if (dep.path.startsWith('.'))
          sources.add(createRequire(path.resolve(project.root, name)).resolve(dep.path));
      }
    }
    for (const name of sources) {
      const resolved = await realpath(path.resolve(project.root, name));
      if (
        !inside(path.join(project.root, 'node_modules'), resolved) &&
        !project.tracked.has(path.relative(project.root, resolved))
      )
        throw new Error(entry + ': bundle input must be tracked: ' + name);
    }
    const outputs: Output[] = [];
    const resources: FileRecord[] = [];
    let command: CommandRecord | undefined;
    for (const name of (await readdir(out)).sort()) {
      const bytes = await readFile(path.join(out, name));
      const relative = path.join(path.dirname(entry), name);
      const record = fileRecord(relative, bytes);
      if (relative === entry) {
        // bun's output metafile can omit surviving imports. scan the emitted command itself.
        const imports: { path: string }[] = JSON.parse(
          execFileSync(
            'bun',
            [
              '--no-install',
              '-p',
              'JSON.stringify(new Bun.Transpiler({loader:"js"}).scanImports(await Bun.stdin.text()))',
            ],
            {
              cwd: scratch,
              env,
              input: bytes.toString('utf8').replace(/^#![^\n]*\n/, ''),
              encoding: 'utf8',
            },
          ),
        );
        for (const dep of imports)
          if (!runtimeBuiltin(dep.path))
            throw new Error(entry + ': bundle has an external dependency: ' + dep.path);
        command = record;
      } else resources.push(record);
      outputs.push({ path: relative, bytes, asset: relative !== entry });
    }
    if (!command) throw new Error('Missing bundled entrypoint ' + entry);
    if (resources.length) command.resources = resources;
    return { command, outputs };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

// expand only tracked members, including links nested inside a linked directory.
async function expand(
  project: CloudProject,
  source: string,
  destination: string,
  ancestors: Set<string>,
  outputs: Output[],
) {
  if (source === template) return;
  const absolute = path.join(project.root, source);
  if (!inside(project.root, absolute) || ancestors.has(source) || !source || source === '.')
    throw new Error('Invalid or cyclic resource link: ' + source);
  if (project.tracked.has(source)) {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (path.isAbsolute(target))
        throw new Error(source + ': expected a relative tracked symlink.');
      await expand(
        project,
        path.normalize(path.join(path.dirname(source), target)),
        destination,
        new Set([...ancestors, source]),
        outputs,
      );
    } else {
      if (!stat.isFile() || (await realpath(absolute)) !== absolute)
        throw new Error('Expected regular tracked file: ' + source);
      outputs.push({ path: destination, bytes: await readFile(absolute), mode: stat.mode });
    }
    return;
  }
  const members = [...project.tracked].filter((file) => file.startsWith(source + '/'));
  if (!members.length || (await realpath(absolute)) !== absolute)
    throw new Error('Expected tracked symlink target: ' + source);
  for (const member of members)
    await expand(
      project,
      member,
      path.join(destination, path.relative(source, member)),
      new Set([...ancestors, source]),
      outputs,
    );
}

async function prepare(project: CloudProject, skill: CloudSkill, env: NodeJS.ProcessEnv) {
  const directory = path.join(project.root, skill.dir);
  if ((await realpath(directory)) !== directory)
    throw new Error('Expected regular skill directory: ' + skill.dir);
  const links: string[] = [];
  const materialized: Output[] = [],
    copied: Output[] = [],
    generated: Output[] = [];
  for (const file of project.tracked) {
    if (!inside(directory, path.join(project.root, file))) continue;
    const absolute = path.join(project.root, file);
    if ((await realpath(path.dirname(absolute))) !== path.dirname(absolute))
      throw new Error('Expected regular tracked parent: ' + file);
    if (!(await lstat(absolute)).isSymbolicLink()) continue;
    if (!skill.symlinks)
      throw new Error(file + ': enable symlinks to materialize this packaged resource.');
    links.push(absolute);
    await expand(project, file, path.relative(directory, absolute), new Set(), materialized);
  }
  for (const file of skill.copies) await expand(project, file, file, new Set(), copied);
  const commands: CommandRecord[] = [];
  for (const entry of skill.entries) {
    const built = await bundle(project, skill, entry, env);
    commands.push(built.command);
    generated.push(...built.outputs);
  }
  if (commands.length)
    generated.push({
      path: 'runtime-files.json',
      bytes: Buffer.from(
        JSON.stringify({ version: project.version, runtime: 'bun', commands }, null, 2) + '\n',
      ),
    });
  const source = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
  const markdown = instructions(source, skill);
  if (markdown !== source) generated.push({ path: 'SKILL.md', bytes: Buffer.from(markdown) });
  return { skill, directory, links, materialized, copied, generated, source };
}

async function outputFile(directory: string, output: Output, overwrite: boolean) {
  const destination = path.join(directory, output.path);
  const parents = path.dirname(output.path).split(path.sep);
  let parent = directory;
  for (const component of parents) {
    parent = path.join(parent, component);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('Refusing to write through symlink: ' + parent);
    if (stat && !stat.isDirectory()) {
      if (!overwrite) return;
      throw new Error('Expected directory: ' + parent);
    }
    if (!stat) await mkdir(parent);
  }
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) throw new Error('Refusing to overwrite a symlink: ' + destination);
  if (stat && output.asset) {
    if (stat.isFile() && (await readFile(destination)).equals(output.bytes)) return;
    throw new Error('Bundled resource conflicts with an existing skill path: ' + destination);
  }
  if (stat && !overwrite) return;
  if (stat && !stat.isFile()) throw new Error('Expected regular output file: ' + destination);
  // rename a fresh file so replacing an entry cannot modify a hard-linked source.
  const scratch = await mkdtemp(path.join(parent, '.cloud-'));
  try {
    const temp = path.join(scratch, 'file');
    await writeFile(temp, output.bytes, { mode: output.mode ?? stat?.mode ?? 0o644 });
    await rename(temp, destination);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function packageCloudSkills(project: CloudProject, env: NodeJS.ProcessEnv) {
  const selected = project.skills.filter((skill) => skill.configured);
  if (selected.some((skill) => skill.entries.length)) {
    try {
      execFileSync('bun', ['--version'], { env, stdio: 'pipe' });
    } catch (error) {
      throw new Error(
        'Command bundling requires Bun. Install Bun and make bun available on PATH.',
        { cause: error },
      );
    }
  }
  // capture inputs before rewriting any skill that another selected skill could import.
  const plans = [];
  for (const skill of selected) plans.push(await prepare(project, skill, env));
  for (const plan of plans) {
    for (const link of plan.links) await unlink(link);
    for (const file of plan.materialized) await outputFile(plan.directory, file, false);
    for (const file of plan.copied) await outputFile(plan.directory, file, false);
    for (const file of plan.generated) await outputFile(plan.directory, file, true);
    await checkCloudSkill(project, plan.skill, project.root, plan.source);
  }
  return selected.map((skill) => skill.dir);
}
