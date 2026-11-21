import { fileURLToPath } from 'node:url';

import { checkDocumentationLinks } from './check-documentation-links.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const documents = ['README.md', 'CLI.md', 'API.md', 'ADVANCED.md', 'CONTRIBUTING.md', 'PLUGINS.md'];

await checkDocumentationLinks(root, documents);
process.stdout.write(`Verified ${documents.length} documentation files and their local links.\n`);
