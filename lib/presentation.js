import ansis from 'ansis';

export function styles(stream, json = false) {
  const enabled =
    !json &&
    !process.env.NO_COLOR &&
    (stream.isTTY || (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0'));
  const plain = (text) => text;
  return {
    bold: enabled ? ansis.bold : plain,
    dim: enabled ? ansis.dim : plain,
    heading: enabled ? ansis.hex('#00c88a') : plain,
    error: enabled ? ansis.red : plain,
  };
}

export function renderResult(result) {
  if (['install', 'refresh'].includes(result.command))
    return [
      'status: ' + result.status,
      'source: ' + (result.source.requested ?? result.source.path),
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
      ...(result.manifestEdit
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
  const diff = result.diff;
  return [
    'status: ' + result.status,
    'source: ' + result.source.path,
    'cache: ' + (result.cachePath ?? 'unresolved'),
    'marketplace: ' + (result.marketplace ?? 'unknown'),
    'identity: ' + result.source.name + '@' + result.source.version,
    'installed: ' + result.inspection.installed,
    'registered: ' + (result.inspection.registered ?? 'unknown'),
    'enabled: ' + (result.inspection.enabled ?? 'unknown'),
    ...(result.issue ? ['note: ' + result.issue] : []),
    ...(diff
      ? Object.entries(diff).map(([key, paths]) => key + ': ' + (paths.join(', ') || 'none'))
      : []),
    ...(result.candidates.length
      ? [
          'cached versions: ' +
            result.candidates
              .map((c) => c.marketplace + '/' + c.directory + ' (' + (c.version ?? 'invalid') + ')')
              .join(', '),
        ]
      : []),
  ].join('\n');
}
