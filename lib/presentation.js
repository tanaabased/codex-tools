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
  if (result.command === 'install')
    return [
      'status: ' + result.status,
      'source: ' + result.source.path,
      'plugin: ' + result.pluginId,
      'catalog: ' + result.catalogPath,
      'mapping: ' + result.mapping.path + ' -> ' + result.mapping.target,
      'installed: ' + result.inspection.installed,
      'enabled: ' + (result.inspection.enabled ?? 'unknown'),
      'authentication: ' + result.inspection.authentication,
      'activation: ' + result.inspection.activation,
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
