import assert from 'node:assert/strict';

import * as api from '../lib/index.ts';
import type {
  CacheOperationResult,
  CodexToolsError,
  CodexToolsOptions,
  InstallationResult,
  NativeResult,
  OperationResult,
  ResolvedContext,
  TreeDiff,
} from '../lib/index.ts';

const runtimeExports = [
  'collectEntries',
  'diffEntries',
  'inspectInstallation',
  'inspectTrees',
  'installPlugin',
  'refreshPlugin',
  'resolveContext',
  'runCLI',
  'runOperation',
  'syncEntries',
] as const;

describe('public API', () => {
  it('exposes exactly the supported runtime functions', () => {
    assert.deepEqual(Object.keys(api).sort(), [...runtimeExports].sort());
    for (const name of runtimeExports) assert.equal(typeof api[name], 'function');
  });

  it('keeps the documented consumer types importable', () => {
    const contract: {
      options?: CodexToolsOptions;
      result?: OperationResult;
      cache?: CacheOperationResult;
      installation?: InstallationResult;
      context?: ResolvedContext;
      diff?: TreeDiff;
      native?: NativeResult;
      failure?: CodexToolsError;
    } = {};
    assert.deepEqual(contract, {});
  });
});
