import assert from 'node:assert/strict';

import validateToolchain from '../utils/validate-toolchain.ts';

describe('dev/utils/validate-toolchain', () => {
  it('should accept matching exact declarations and runtime', () => {
    validateToolchain('1.4.2', 'bun@1.4.2', '1.4.2');
  });

  it('should reject ranges and independently mismatched declarations or runtime', () => {
    assert.throws(() => validateToolchain('^1.4.2', 'bun@1.4.2', '1.4.2'), /exact stable/);
    assert.throws(() => validateToolchain('1.4.2', 'bun@1.3.14', '1.4.2'), /packageManager/);
    assert.throws(() => validateToolchain('1.4.2', 'bun@1.4.2', '1.3.14'), /found 1.3.14/);
  });
});
