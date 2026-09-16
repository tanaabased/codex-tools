import assert from 'node:assert/strict';

import { assertSupportedCodexVersion, readNativeResult, runNative } from '../lib/codex-native.ts';

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
    assert.equal(assertSupportedCodexVersion('codex-cli 0.153.4'), 'codex-cli 0.153.4');
    assert.throws(
      () => assertSupportedCodexVersion('codex-cli 0.154.0'),
      /Supported native contract is Codex 0\.153\.x; found codex-cli 0\.154\.0/,
    );
    assert.throws(
      () =>
        assertSupportedCodexVersion('unexpected', {
          unsupportedMessage: 'Unsupported Codex version.',
        }),
      /^Error: Unsupported Codex version\.$/,
    );
  });
});
