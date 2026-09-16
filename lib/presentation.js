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
