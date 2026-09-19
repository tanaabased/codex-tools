import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const external = /^[a-z][a-z+.-]*:/i;

/** extracts the fenced code block immediately following one named documentation marker. */
export function documentationExample(markdown: string, name: string): string {
  const marker = `<!-- codex-tools-example:${name} -->`;
  const offset = markdown.indexOf(marker);
  assert.notEqual(offset, -1, `Missing documentation example marker ${marker}`);
  const body = markdown.slice(offset + marker.length);
  const match = /^\s*```[^\n]*\n([\s\S]*?)\n```/.exec(body);
  assert.ok(match, `Missing fenced code after documentation example marker ${marker}`);
  return match[1]!.trimEnd() + '\n';
}

function anchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

async function anchors(file: string): Promise<Set<string>> {
  const counts = new Map<string, number>();
  const values = new Set<string>();
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line)?.[1];
    if (!heading) continue;
    const base = anchor(heading);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    values.add(count ? `${base}-${count}` : base);
  }
  return values;
}

/** verifies local markdown links, heading anchors, and html image sources. */
export async function checkDocumentationLinks(root: string, documents: readonly string[]) {
  const headings = new Map<string, Set<string>>();
  for (const relative of documents) {
    const source = path.resolve(root, relative);
    const markdown = await readFile(source, 'utf8');
    const links = [
      ...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g),
      ...markdown.matchAll(/<img\b[^>]*\bsrc=['"]([^'"]+)['"][^>]*>/gi),
    ];
    for (const match of links) {
      const href = match[1]!;
      if (external.test(href)) continue;
      const [rawTarget = '', rawFragment] = href.split('#', 2);
      const target = rawTarget
        ? path.resolve(path.dirname(source), decodeURIComponent(rawTarget))
        : source;
      await readFile(target);
      if (!rawFragment) continue;
      let values = headings.get(target);
      if (!values) {
        values = await anchors(target);
        headings.set(target, values);
      }
      assert.ok(
        values.has(decodeURIComponent(rawFragment).toLowerCase()),
        `${relative} links to missing anchor ${href}`,
      );
    }
  }
}
