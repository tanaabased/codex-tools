import ansis from 'ansis';
import type { CacheOperationResult, OperationResult } from './operations.ts';
import type { InstallationResult } from './install-types.ts';

export interface StyleSet {
  bold: (text: string) => string;
  dim: (text: string) => string;
  heading: (text: string) => string;
  error: (text: string) => string;
}

function installationResult(result: OperationResult): result is InstallationResult {
  return result.command === 'install' || result.command === 'refresh';
}

export function styles(stream: { isTTY?: boolean }, json = false): StyleSet {
  const enabled =
    !json &&
    !process.env.NO_COLOR &&
    (stream.isTTY || (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0'));
  const plain = (text: string) => text;
  return {
    bold: enabled ? ansis.bold : plain,
    dim: enabled ? ansis.dim : plain,
    heading: enabled ? ansis.hex('#00c88a') : plain,
    error: enabled ? ansis.red : plain,
  };
}

export function renderResult(result: OperationResult): string {
  if (installationResult(result))
    return [
      'status: ' + result.status,
      'source: ' + (result.source.requested ?? result.source.path ?? 'unknown'),
      'plugin: ' + (result.pluginId ?? 'pending manifest inspection'),
      'catalog: ' + result.catalogPath,
      ...(result.mapping
        ? ['mapping: ' + result.mapping.path + ' -> ' + result.mapping.target]
        : []),
      ...(result.source.type === 'npm'
        ? [
            'package version: ' + (result.source.version ?? 'pending'),
            'registry: ' + (result.source.registry ?? 'pending'),
          ]
        : []),
      'installed: ' + result.inspection.installed,
      'enabled: ' + (result.inspection.enabled ?? 'unknown'),
      'authentication: ' + result.inspection.authentication,
      'activation: ' + result.inspection.activation,
      ...(result.manifestEdit && result.effects
        ? [
            'manifest: ' +
              result.manifestEdit.before +
              ' -> ' +
              result.manifestEdit.after +
              (result.manifestEdit.applied ? ' (applied)' : ' (planned)'),
            'installation observation: ' + result.inspection.phase,
            'payload: ' + result.inspection.payload,
            'reinstall attempted: ' + result.effects.reinstallAttempted,
            'preservation: ' + result.effects.preservation,
          ]
        : []),
      ...result.plan.map(
        (step) =>
          (result.completed.includes(step)
            ? step.skipped
              ? 'unchanged: '
              : 'completed: '
            : 'pending: ') +
          step.operation +
          ' ' +
          (step.argv ? JSON.stringify(['codex', ...step.argv]) : (step.path ?? '')),
      ),
      ...(result.issue ? ['note: ' + result.issue] : []),
      ...(result.sourceEdit ? ['source edit: ' + result.sourceEdit] : []),
      ...(result.nativeState ? ['native state: ' + result.nativeState] : []),
      ...(result.guidance ? ['next: ' + result.guidance] : []),
    ].join('\n');
  const cacheResult: CacheOperationResult = result;
  const diff = cacheResult.diff;
  return [
    'status: ' + cacheResult.status,
    'source: ' + cacheResult.source.path,
    'cache: ' + (cacheResult.cachePath ?? 'unresolved'),
    'marketplace: ' + (cacheResult.marketplace ?? 'unknown'),
    'identity: ' + cacheResult.source.name + '@' + cacheResult.source.version,
    'installed: ' + cacheResult.inspection.installed,
    'registered: ' + (cacheResult.inspection.registered ?? 'unknown'),
    'enabled: ' + (cacheResult.inspection.enabled ?? 'unknown'),
    ...(cacheResult.issue ? ['note: ' + cacheResult.issue] : []),
    ...(diff
      ? (['changed', 'extra', 'missing'] as const).map(
          (key) => key + ': ' + (diff[key].join(', ') || 'none'),
        )
      : []),
    ...(cacheResult.candidates.length
      ? [
          'cached versions: ' +
            cacheResult.candidates
              .map((c) => c.marketplace + '/' + c.directory + ' (' + (c.version ?? 'invalid') + ')')
              .join(', '),
        ]
      : []),
  ].join('\n');
}
