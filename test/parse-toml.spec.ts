import assert from 'node:assert/strict';

import parseToml from '../utils/parse-toml.ts';

describe('utils/parse-toml', () => {
  it('should preserve the Codex configuration shapes consumed by the package', () => {
    const parsed = parseToml(
      [
        'model = "gpt-6-astra"',
        '[marketplaces.personal]',
        'source_type = "local"',
        'source = "/tmp/plugins"',
        '[plugins."sample@personal"]',
        'enabled = false',
        '',
      ].join('\n'),
    ) as Record<string, unknown>;
    assert.deepEqual(parsed, {
      model: 'gpt-6-astra',
      marketplaces: { personal: { source_type: 'local', source: '/tmp/plugins' } },
      plugins: { 'sample@personal': { enabled: false } },
    });
  });

  it('should reject malformed configuration', () => {
    assert.throws(() => parseToml('not valid toml ]'));
  });
});
