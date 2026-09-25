import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as api from '@tanaab/codex-tools';

const expected = JSON.parse(await readFile(new URL('./exports.json', import.meta.url), 'utf8'));
assert.deepEqual(Object.keys(api).sort(), expected);
for (const value of Object.values(api)) assert.equal(typeof value, 'function');
