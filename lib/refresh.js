import { TOML } from 'bun';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { collectEntries } from './cache.js';
import { assertSupportedCodexVersion, readNativeResult, runNative } from './codex-native.js';
import { inside, object, optional, resolveInstall, snapshot } from './install-context.js';
import { installNpmPlugin } from './npm-install.js';
import diffEntries from '../utils/diff-entries.js';
import hasDiff from '../utils/has-diff.js';

// Plugin Creator's prefix-before-+ and single +codex.<UTC timestamp> convention.
export async function planCachebuster(version, cacheRoot, now = new Date()) {
  if (typeof version !== 'string' || !version.trim())
    throw new Error('Refresh requires a non-empty source manifest version.');
  const occupied = new Set((await optional(() => readdir(cacheRoot))) ?? []);
  occupied.add(version);
  const base = version.split('+', 1)[0];
  if (!base) throw new Error('Refresh requires a non-empty base version.');
  const date = new Date(now);
  let next;
  do {
    next = base + '+codex.' + date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    date.setUTCSeconds(date.getUTCSeconds() + 1);
  } while (occupied.has(next));
  return next;
}

export async function refreshPlugin(
  options = {},
  { env = process.env, native = runNative, now = new Date(), npm } = {},
) {
  if (options.npmSelector)
    return installNpmPlugin({ ...options, command: 'refresh' }, { env, native, npm });
  const context = await resolveInstall(options, env);
  const { source, root, home, catalog, catalogFile, mapping } = context;
  if (
    context.createCodexHome ||
    !context.catalogSnapshot ||
    context.editCatalog ||
    context.addMapping ||
    context.register ||
    context.directories.length
  )
    throw new Error(
      'Refresh requires an existing local marketplace and matching source mapping; run install first.',
    );
  const codexHome = await realpath(context.codexHome);
  if (inside(source.root, codexHome))
    throw new Error('Plugin source overlaps the selected Codex home.');
  const pluginId = source.manifest.name + '@' + catalog.name;
  const cacheRoot = path.join(codexHome, 'plugins/cache', catalog.name, source.manifest.name);
  async function checkCacheParents() {
    let current = codexHome;
    for (const part of path.relative(codexHome, cacheRoot).split(path.sep)) {
      current = path.join(current, part);
      const stats = await optional(() => lstat(current));
      if (stats && !stats.isDirectory())
        throw new Error('Native cache parent must be a real directory: ' + current);
    }
  }
  await checkCacheParents();
  const nextVersion = await planCachebuster(source.manifest.version, cacheRoot, now);
  const cachePath = path.join(cacheRoot, nextVersion);
  const manifestText = JSON.stringify({ ...source.manifest, version: nextVersion }, null, 2) + '\n';
  const expectedSource = await collectEntries(source.root);
  if ([...expectedSource.values()].some((entry) => entry.type === 'symlink'))
    throw new Error(
      'Native Codex skips payload symlinks; refresh requires a regular-file payload.',
    );
  const result = {
    command: 'refresh',
    source: {
      path: source.root,
      valid: true,
      name: source.manifest.name,
      version: source.manifest.version,
    },
    codexHome,
    marketplace: catalog.name,
    marketplaceRoot: root,
    catalogPath: catalogFile,
    mapping: { path: mapping, target: source.root },
    pluginId,
    cachePath,
    dryRun: Boolean(options.dryRun),
    ok: false,
    status: 'planned',
    issue: null,
    manifestEdit: {
      path: source.file,
      before: source.manifest.version,
      after: nextVersion,
      applied: false,
    },
    inspection: {
      phase: 'pending',
      installed: null,
      enabled: null,
      payload: 'pending',
      authentication: 'unknown',
      activation: 'unknown',
    },
    effects: { reinstallAttempted: false, nativeSucceeded: false, preservation: 'pending' },
    guidance:
      'Start a new Codex task to pick up refreshed skills and tools; restart Codex if they remain unavailable. Existing-task pickup is unverified.',
    plan: [
      { operation: 'preflight', argv: ['--version'] },
      { operation: 'inspect-marketplaces', argv: ['plugin', 'marketplace', 'list', '--json'] },
      {
        operation: 'inspect-installation',
        argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
      },
      {
        operation: 'edit-manifest',
        path: source.file,
        before: source.manifest.version,
        after: nextVersion,
      },
      { operation: 'reinstall', argv: ['plugin', 'add', '--json', '--', pluginId] },
      {
        operation: 'readback',
        argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
      },
      { operation: 'verify-payload', path: cachePath },
      { operation: 'verify-preservation' },
    ],
    completed: [],
    remaining: [],
    native: [],
  };
  result.remaining = [...result.plan];
  if (options.dryRun) {
    result.ok = true;
    result.issue =
      'Native compatibility, existing installation, enablement, and payload verification are pending; dry run starts no native process.';
    return result;
  }
  const nativeOptions = { env: { ...env, HOME: home, CODEX_HOME: codexHome }, cwd: home };
  let expectedManifest = source.original;
  let beforeInstalled;
  const unrelated = (rows) =>
    rows
      .filter((row) => row.pluginId !== pluginId)
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  async function call(argv, json = true) {
    const child = await native(argv, nativeOptions);
    result.native.push(child);
    if (argv[1] === 'add') result.effects.nativeSucceeded = child.exitCode === 0;
    if (child.exitCode !== 0) {
      result.nativeError = child;
      result.exitCode = child.exitCode;
    }
    return readNativeResult(child, { json });
  }
  async function unchanged() {
    await checkCacheParents();
    const current = await resolveInstall(options, env);
    if (
      current.root !== root ||
      current.source.root !== source.root ||
      current.mapping !== mapping ||
      !isDeepStrictEqual(current.mappingStats, context.mappingStats) ||
      !isDeepStrictEqual(current.catalogSnapshot, context.catalogSnapshot)
    )
      throw new Error('Marketplace or source mapping changed during refresh.');
    const configMatches = result.effects.reinstallAttempted
      ? isDeepStrictEqual(
          TOML.parse(current.configSnapshot?.text ?? ''),
          TOML.parse(context.configSnapshot?.text ?? ''),
        )
      : isDeepStrictEqual(current.configSnapshot, context.configSnapshot);
    if (!configMatches)
      throw new Error('Codex configuration changed during refresh; preservation is incomplete.');
    if (
      !isDeepStrictEqual(current.source.original, expectedManifest) ||
      !isDeepStrictEqual(await collectEntries(source.root), expectedSource)
    )
      throw new Error('Source changed during refresh; rerun with a stable source.');
  }
  async function readback(argv, refreshed) {
    const data = await call(argv);
    if (
      !Array.isArray(data?.installed) ||
      data.installed.some((row) => !object(row) || typeof row.pluginId !== 'string')
    )
      throw new Error('Unsupported native installation readback.');
    const matches = data.installed.filter((row) => row.pluginId === pluginId);
    if (matches.length !== 1 || matches[0].installed !== true)
      throw new Error(
        'Selected installation is absent or ambiguous; refresh requires an installed plugin.',
      );
    const found = matches[0];
    if (
      found.name !== source.manifest.name ||
      found.marketplaceName !== catalog.name ||
      found.source?.source !== 'local' ||
      typeof found.source.path !== 'string' ||
      (await realpath(found.source.path)) !== source.root
    )
      throw new Error('Installed plugin source does not match selected local source.');
    result.inspection = {
      ...result.inspection,
      phase: refreshed ? 'readback' : 'before-reinstall',
      installed: true,
      enabled: found.enabled,
      version: found.version,
    };
    if (typeof found.version !== 'string' || typeof found.enabled !== 'boolean')
      throw new Error('Unsupported native installation state.');
    if (!found.enabled)
      throw new Error(
        'Disabled plugin cannot be refreshed without enabling it: native add enables plugins. Enable it explicitly in Codex first.',
      );
    if (refreshed) {
      if (found.version !== nextVersion)
        throw new Error('Native reinstall did not select the refreshed version.');
      if (!isDeepStrictEqual(unrelated(data.installed), unrelated(beforeInstalled)))
        throw new Error('Unrelated native installation state changed during refresh.');
    } else beforeInstalled = data.installed;
  }
  try {
    for (const operation of result.plan) {
      await unchanged();
      switch (operation.operation) {
        case 'preflight':
          result.codexVersion = assertSupportedCodexVersion(await call(operation.argv, false));
          break;
        case 'inspect-marketplaces': {
          const data = await call(operation.argv);
          if (!Array.isArray(data?.marketplaces))
            throw new Error('Unsupported native marketplace readback.');
          const matches = data.marketplaces.filter((row) => row?.name === catalog.name);
          if (
            matches.length !== 1 ||
            typeof matches[0].root !== 'string' ||
            (await realpath(matches[0].root)) !== root ||
            (matches[0].marketplaceSource && matches[0].marketplaceSource.sourceType !== 'local')
          )
            throw new Error(
              'Selected native marketplace is absent, ambiguous, or not the matching local source.',
            );
          break;
        }
        case 'inspect-installation':
          await readback(operation.argv, false);
          break;
        case 'edit-manifest': {
          if (await optional(() => lstat(cachePath)))
            throw new Error('Planned cache version already exists; rerun to replan.');
          const temporary = source.file + '.' + randomUUID() + '.tmp';
          try {
            await writeFile(temporary, manifestText, { flag: 'wx', mode: source.original.mode });
            await chmod(temporary, source.original.mode & 0o777);
            // The temporary file is ours, not a concurrent source edit.
            expectedSource.set(path.relative(source.root, temporary), {
              type: 'file',
              mode: source.original.mode & 0o777,
              content: Buffer.from(manifestText),
            });
            await unchanged();
            await rename(temporary, source.file);
            result.manifestEdit.applied = true;
          } finally {
            await rm(temporary, { force: true });
            expectedSource.delete(path.relative(source.root, temporary));
          }
          expectedManifest = await snapshot(source.file);
          expectedSource.set(path.relative(source.root, source.file), {
            ...expectedSource.get(path.relative(source.root, source.file)),
            content: Buffer.from(manifestText),
          });
          break;
        }
        case 'reinstall': {
          if (await optional(() => lstat(cachePath)))
            throw new Error('Planned cache version already exists; rerun to replan.');
          result.effects.reinstallAttempted = true;
          const data = await call(operation.argv);
          if (
            data?.pluginId !== pluginId ||
            data.name !== source.manifest.name ||
            data.marketplaceName !== catalog.name ||
            data.version !== nextVersion ||
            data.installedPath !== cachePath
          )
            throw new Error(
              'Native reinstall returned an unexpected installation identity or path.',
            );
          break;
        }
        case 'readback':
          await readback(operation.argv, true);
          break;
        case 'verify-payload': {
          if ((await realpath(cachePath)) !== cachePath || !(await lstat(cachePath)).isDirectory())
            throw new Error('Refreshed cache is not a regular installation directory.');
          result.diff = diffEntries(expectedSource, await collectEntries(cachePath));
          result.inspection.payload = hasDiff(result.diff) ? 'mismatch' : 'verified';
          if (hasDiff(result.diff))
            throw new Error('Refreshed payload does not match the source snapshot.');
          await unchanged();
          break;
        }
        case 'verify-preservation':
          result.effects.preservation = 'verified';
          break;
      }
      result.completed.push(operation);
      result.remaining = result.plan.slice(result.completed.length);
    }
    result.ok = true;
    result.status = 'refreshed';
  } catch (error) {
    result.status = 'incomplete';
    result.issue = error.message;
    result.exitCode ??= 2;
    if (result.effects.reinstallAttempted)
      result.nativeState =
        'Native reinstall may have changed cache or configuration. Inspect before retrying; no rollback was attempted.';
    if (result.manifestEdit.applied)
      result.sourceEdit =
        'The source manifest was edited; no rollback was attempted. Inspect its current contents before retrying.';
  }
  return result;
}
