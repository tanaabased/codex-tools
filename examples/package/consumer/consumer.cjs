const assert = require('node:assert/strict');
const api = require('@tanaab/codex-tools');

assert.deepEqual(Object.keys(api).sort(), require('./exports.json'));
for (const value of Object.values(api)) assert.equal(typeof value, 'function');
