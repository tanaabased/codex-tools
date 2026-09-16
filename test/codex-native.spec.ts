import assert from 'node:assert/strict';

import {
  assertSupportedCodexVersion,
  readNativePluginInspection,
  readNativeResult,
  readNativeRows,
  runNative,
  supportedCodexFamily,
  supportedCodexVersion,
} from '../lib/codex-native.ts';

describe('lib/codex-native', () => {
  it('should execute a bounded child and decode its JSON response', async () => {
    const child = await runNative(['-e', 'process.stdout.write(JSON.stringify({ok:true}))'], {
      cwd: process.cwd(),
      env: process.env,
      executable: process.execPath,
    });

    assert.equal(child.exitCode, 0);
    assert.deepEqual(readNativeResult(child), { ok: true });
  });

  it('should preserve text responses and reject invalid JSON', () => {
    const child = { argv: [], exitCode: 0, stdout: ' codex-cli 0.153.4\n', stderr: '' };

    assert.equal(readNativeResult(child, { json: false }), 'codex-cli 0.153.4');
    assert.throws(
      () => readNativeResult({ ...child, stdout: '{' }),
      /Native Codex returned invalid JSON/,
    );
  });

  it('should prefer a sanitized failure over raw child output', () => {
    const child = { argv: [], exitCode: 37, stdout: 'secret', stderr: 'token=secret' };

    assert.throws(
      () => readNativeResult(child, { failureMessage: 'Sanitized native failure.' }),
      /^Error: Sanitized native failure\.$/,
    );
  });

  it('should enforce the supported Codex contract with caller-owned wording', () => {
    assert.equal(
      assertSupportedCodexVersion('codex-cli ' + supportedCodexVersion),
      'codex-cli ' + supportedCodexVersion,
    );
    assert.throws(
      () => assertSupportedCodexVersion('codex-cli 0.154.0'),
      new RegExp(
        'Supported native contract is Codex ' +
          supportedCodexFamily.replaceAll('.', '\\.') +
          '; found codex-cli 0\\.154\\.0',
      ),
    );
    assert.throws(
      () =>
        assertSupportedCodexVersion('unexpected', {
          unsupportedMessage: 'Unsupported Codex version.',
        }),
      /^Error: Unsupported Codex version\.$/,
    );
  });

  it('should decode supported marketplace and installation fixture envelopes', () => {
    assert.deepEqual(
      readNativeRows({ marketplaces: [{ name: 'personal', root: '/tmp' }] }, 'marketplaces'),
      [{ name: 'personal', root: '/tmp' }],
    );
    assert.deepEqual(
      readNativeRows(
        { installed: [{ pluginId: 'sample@personal', installed: true, enabled: true }] },
        'installed',
      ),
      [{ pluginId: 'sample@personal', installed: true, enabled: true }],
    );
  });

  it('should reject malformed native list fixtures before callers apply policy', () => {
    for (const [value, field] of [
      [null, 'installed'],
      [{}, 'installed'],
      [{ installed: {} }, 'installed'],
      [{ installed: [null] }, 'installed'],
      [{ installed: [{}] }, 'installed'],
      [{ marketplaces: [{}] }, 'marketplaces'],
    ] as const) {
      assert.throws(
        () => readNativeRows(value, field),
        new RegExp(
          'Unsupported native ' + (field === 'installed' ? 'installation' : 'marketplace'),
        ),
      );
    }
  });

  it('should decode and reject native package-inspection fixtures', () => {
    const fixture = {
      name: 'sample',
      pluginId: 'sample@inspection',
      version: '1.0.0',
      installedPath: '/tmp/sample',
      ignored: true,
    };
    assert.deepEqual(readNativePluginInspection(fixture), {
      name: 'sample',
      pluginId: 'sample@inspection',
      version: '1.0.0',
      installedPath: '/tmp/sample',
    });
    for (const value of [null, {}, { ...fixture, name: '' }, { ...fixture, installedPath: 42 }]) {
      assert.throws(() => readNativePluginInspection(value), /unexpected package identity or path/);
    }
  });
});
