import npa from 'npm-package-arg';
import semver from 'semver';

export function parseNpmSelector(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith('npm:')) throw new Error();
    const spec = value.slice(4);
    const parsed = npa(spec);
    if (
      !parsed.name ||
      !parsed.registry ||
      !['version', 'range', 'tag'].includes(parsed.type) ||
      !/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[^@]+)?$/.test(spec) ||
      (parsed.type === 'tag' && !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(parsed.rawSpec))
    )
      throw new Error();
    return {
      requested: value,
      package: parsed.name,
      selector: spec === parsed.name ? 'latest' : parsed.rawSpec,
      type: spec === parsed.name ? 'tag' : parsed.type,
      explicitVersion: spec !== parsed.name,
    };
  } catch {
    throw new Error(
      'Invalid npm selector. Use npm:package, npm:@scope/package@version, a tag, or a quoted version range; paths and URLs are not supported.',
    );
  }
}

export function registryUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error(
      'npm registry must be an HTTPS URL without credentials, query, or fragment. Configure authentication in npm configuration.',
    );
  }
}

export function exactVersion(value) {
  return (
    typeof value === 'string' &&
    /^[0-9]/.test(value) &&
    value.trim() === value &&
    Boolean(semver.valid(value))
  );
}

export function resolvedVersion(value) {
  const versions = Array.isArray(value) ? value : [value];
  if (!versions.length || versions.some((version) => !exactVersion(version)))
    throw new Error('npm did not return an exact package version.');
  return versions.sort(semver.rcompare)[0];
}
