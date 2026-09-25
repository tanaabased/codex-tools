import tools = require('@tanaab/codex-tools');
import type { CacheOperationResult, CodexToolsOptions } from '@tanaab/codex-tools';
export type {
  CodexToolsError,
  InstallationResult,
  NativeResult,
  OperationResult,
  ResolvedContext,
  TreeDiff,
} from '@tanaab/codex-tools';

const options: CodexToolsOptions = { repoRoot: '/source', cachePathOverride: '/cache' };
const result: Promise<CacheOperationResult> = tools.runOperation('check', options);
void result;
