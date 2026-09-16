import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import extractPackageScriptNames from '../utils/extract-package-script-names.js';
import normalizeLocalMarkdownTarget from '../utils/normalize-local-markdown-target.js';

function inside(root, target) {
  const rel = relative(root, target);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

async function collect(root, target, predicate, files = [], seen = new Set()) {
  if (!inside(root, target)) throw new Error('Check scope escapes repository: ' + target);
  let metadata;
  try {
    metadata = await stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  const actual = await realpath(target);
  if (!inside(root, actual)) throw new Error('Check scope resolves outside repository: ' + target);
  if (seen.has(actual)) return files;
  seen.add(actual);
  if (metadata.isFile() && predicate(target)) files.push(target);
  if (metadata.isDirectory()) {
    for (const name of (await readdir(target)).sort()) {
      if (['.git', 'node_modules'].includes(name)) continue;
      await collect(root, resolve(target, name), predicate, files, seen);
    }
  }
  return files;
}

/** Canon's link check with caller-owned roots and resolved containment. */
export async function validateMarkdownLinks({ repoRoot, roots }) {
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string'))
    throw new TypeError('Markdown roots must be an explicit array of paths.');
  const root = await realpath(resolve(repoRoot));
  const failures = [];
  for (const entry of roots) {
    for (const file of await collect(root, resolve(root, entry), (p) => p.endsWith('.md'))) {
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
        const target = normalizeLocalMarkdownTarget(match[1]);
        if (!target) continue;
        const resolved = resolve(dirname(file), target);
        let valid = inside(root, resolved);
        try {
          valid = valid && inside(root, await realpath(resolved));
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
          valid = false;
        }
        if (!valid) failures.push(`broken Markdown link in ${relative(root, file)}: ${match[1]}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Me/Canon's workflow script check; does not execute workflow commands. */
export async function validateWorkflowPackageScripts({ repoRoot }) {
  const root = await realpath(resolve(repoRoot));
  const files = await collect(root, resolve(root, '.github/workflows'), (p) => /\.ya?ml$/.test(p));
  const failures = [];
  if (files.length) {
    const packagePath = resolve(root, 'package.json');
    if (!inside(root, await realpath(packagePath)))
      throw new Error('package.json resolves outside repository.');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    const scripts = new Set(Object.keys(pkg.scripts ?? {}));
    for (const file of files) {
      for (const name of extractPackageScriptNames(await readFile(file, 'utf8'))) {
        if (!scripts.has(name))
          failures.push(`workflow ${relative(root, file)} calls missing package script: ${name}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Me's starter-prompt check, including its required installed-skill reference. */
export function validatePromptReferences({
  manifest,
  skillNames,
  requireInstalledReference = true,
}) {
  const raw = manifest?.interface?.defaultPrompt ?? manifest?.interface?.default_prompt ?? [];
  const prompts = (Array.isArray(raw) ? raw : [raw])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean);
  const names = new Set(skillNames);
  const references = new Set(
    prompts.flatMap((p) => [...p.matchAll(/\$([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)].map((m) => m[1])),
  );
  const failures = [];
  if (!prompts.length)
    failures.push('plugin interface.defaultPrompt must include at least one starter prompt.');
  for (const name of references)
    if (!names.has(name)) failures.push('starter prompt references unknown skill: ' + name);
  if (requireInstalledReference && ![...references].some((name) => names.has(name)))
    failures.push('plugin interface.defaultPrompt must reference at least one installed skill.');
  return { ok: failures.length === 0, failures };
}
