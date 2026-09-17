import { fileURLToPath } from 'node:url';

import { checkDocumentationLinks } from '../lib/documentation.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const documents = ['README.md', 'CLI.md', 'API.md', 'CONTRIBUTING.md'];

await checkDocumentationLinks(root, documents);
process.stdout.write(`Verified ${documents.length} documentation files and their local links.\n`);
