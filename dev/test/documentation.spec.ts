import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { checkDocumentationLinks } from '../lib/documentation.ts';

describe('dev/lib/documentation', () => {
  it('should check local links, duplicate heading anchors, and HTML image sources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-tools-docs-'));
    try {
      await writeFile(path.join(root, 'guide.md'), '# Usage\n\n# Usage\n');
      await writeFile(path.join(root, 'icon.png'), 'fixture');
      const readme = path.join(root, 'README.md');
      await writeFile(
        readme,
        '[Usage](./guide.md#usage-1)\n<img src="./icon.png" />\n[Web](https://example.com)',
      );
      await checkDocumentationLinks(root, ['README.md']);
      await writeFile(readme, '[Missing](./guide.md#unknown)');
      await assert.rejects(checkDocumentationLinks(root, ['README.md']), /missing anchor/);
      await writeFile(readme, '<img src="./missing.png" />');
      await assert.rejects(checkDocumentationLinks(root, ['README.md']), /ENOENT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
