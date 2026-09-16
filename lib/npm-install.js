import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  exactVersion,
  parseNpmSelector,
  registryUrl,
  resolvedVersion,
} from '../utils/npm-selector.js';
import { inside, resolveMarketplace, snapshot, validateSource } from './install-context.js';
import { performInstall, runNative } from './install.js';

export const runNpm = (argv, options) =>
  runNative(argv, { ...options, executable: 'npm', timeoutMs: 60000 });

// npm and native npm failures can echo authentication configuration. Keep raw output private.
export function npmFailure(child, operation) {
  const output = String(child.stderr ?? '') + String(child.stdout ?? '');
  const code = output.match(
    /\b(E401|E403|E404|ETARGET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EINTEGRITY)\b/,
  )?.[1];
  const hint =
    code === 'E401' || code === 'E403'
      ? 'Check registry access and authentication in npm configuration.'
      : code === 'E404' || code === 'ETARGET'
        ? 'Check the package name, requested release, and registry access.'
        : 'Check npm/Codex availability, registry connectivity, and the packaged plugin manifest and files.';
  return `${operation} failed${code ? ' (' + code + ')' : ''}. ${hint} Raw subprocess output is withheld because it may contain registry credentials.`;
}

function registryEnv(env, source) {
  const selected = { ...env, npm_config_registry: source.registry };
  if (source.package.startsWith('@'))
    selected['npm_config_' + source.package.split('/')[0] + ':registry'] = source.registry;
  return selected;
}

export function safeNpmNative(native, source) {
  return async (argv, options) => {
    const child = await native(argv, {
      ...options,
      env: registryEnv(options.env, source),
      timeoutMs: 120000,
    });
    if (child.exitCode !== 0)
      return {
        argv,
        exitCode: child.exitCode,
        stdout: '',
        stderr: npmFailure(child, 'Native Codex'),
        error: undefined,
      };
    return { ...child, stderr: '' };
  };
}

function pinnedEntry(context, selection) {
  const matches = context.catalog.plugins.filter(
    (entry) => entry?.source?.source === 'npm' && entry.source.package === selection.package,
  );
  if (matches.length !== 1 || !exactVersion(matches[0].source.version))
    throw new Error(
      'npm refresh requires one existing exact-version package entry in the selected marketplace. Run install first.',
    );
  const entry = matches[0];
  if (selection.explicitVersion && selection.selector !== entry.source.version)
    throw new Error(
      'Refresh cannot select another release, tag, or range. Use install to select a release, or refresh npm:' +
        selection.package +
        ' to retain the installed release.',
    );
  if (
    entry.codexTools?.npm?.requested !== undefined &&
    parseNpmSelector(entry.codexTools.npm.requested).package !== selection.package
  )
    throw new Error('Recorded npm provenance does not match the selected package.');
  registryUrl(entry.source.registry);
  return entry;
}

function preview(options, selection, context, pinned) {
  return {
    command: options.command === 'refresh' ? 'refresh' : 'install',
    dryRun: true,
    ok: true,
    status: 'planned',
    source: {
      type: 'npm',
      requested: selection.requested,
      package: selection.package,
      version: pinned?.source.version ?? null,
      registry: pinned?.source.registry ?? null,
      name: pinned?.name ?? null,
      valid: null,
      validation: 'pending; basic installation prerequisites only',
    },
    codexHome: context.codexHome,
    marketplace: context.catalog.name,
    marketplaceRoot: context.root,
    catalogPath: context.catalogFile,
    inspection: {
      installed: null,
      enabled: null,
      authentication: 'unknown',
      activation: 'unknown',
    },
    plan: [
      { operation: 'preflight', argv: ['--version'] },
      {
        operation: pinned ? 'retain-pinned-release' : 'resolve-npm',
        version: pinned?.source.version ?? null,
      },
      { operation: 'inspect-package', method: 'native npm install in a disposable Codex home' },
      { operation: 'check-prerequisites', status: 'pending' },
      {
        operation: 'reconcile-marketplace',
        condition: 'after manifest identity and collision checks',
      },
      { operation: pinned ? 'reinstall' : 'install', condition: 'after native inspection' },
      { operation: 'readback' },
    ],
    native: [],
    completed: [],
    remaining: [],
    issue:
      'No subprocesses or writes were performed. Registry resolution, payload checks, native compatibility, and installation state remain pending.',
  };
}

export async function installNpmPlugin(
  options,
  { env = process.env, native = runNative, npm = runNpm } = {},
) {
  const selection = parseNpmSelector(options.npmSelector);
  if (options.repoRoot !== undefined)
    throw new Error('Select an npm selector or a local plugin path, not both.');
  const context = await resolveMarketplace(options, env);
  const refreshing = options.command === 'refresh';
  const pinned = refreshing ? pinnedEntry(context, selection) : null;
  const result = preview(options, selection, context, pinned);
  result.remaining = [...result.plan];
  if (options.dryRun) return result;
  result.dryRun = false;
  result.ok = false;
  result.status = 'incomplete';
  let staging;
  const npmOptions = { env, cwd: process.cwd() };
  async function npmJson(argv, json = true) {
    const child = await npm(argv, npmOptions);
    if (child.exitCode !== 0) {
      result.exitCode = child.exitCode || 2;
      throw new Error(npmFailure(child, 'npm metadata resolution'));
    }
    if (!json) return child.stdout.trim();
    try {
      return JSON.parse(child.stdout);
    } catch {
      throw new Error('npm returned invalid metadata JSON.');
    }
  }
  try {
    const version = await native(['--version'], { env, cwd: context.home });
    if (version.exitCode !== 0) {
      result.exitCode = version.exitCode || 2;
      throw new Error(npmFailure(version, 'Codex preflight'));
    }
    const reportedVersion = version.stdout.trim();
    if (!/^codex-cli 0\.153\.\d+$/.test(reportedVersion))
      throw new Error(
        'Supported native contract is Codex 0.153.x; found an unsupported Codex version.',
      );
    result.codexVersion = reportedVersion;
    const npmVersion = await npm(['--version'], npmOptions);
    if (npmVersion.exitCode !== 0 || !/^\d+\.\d+\.\d+\s*$/.test(npmVersion.stdout)) {
      result.exitCode = npmVersion.exitCode || 2;
      throw new Error(npmFailure(npmVersion, 'npm preflight'));
    }
    result.npmVersion = npmVersion.stdout.trim();
    let registry = pinned?.source.registry;
    if (!registry && selection.package.startsWith('@'))
      registry = await npmJson(
        ['config', 'get', selection.package.split('/')[0] + ':registry'],
        false,
      );
    if (!registry || registry === 'undefined')
      registry = await npmJson(['config', 'get', 'registry'], false);
    registry = registryUrl(registry);
    const release =
      pinned?.source.version ??
      resolvedVersion(
        await npmJson([
          'view',
          selection.package + '@' + selection.selector,
          'version',
          '--json',
          '--registry=' + registry,
        ]),
      );
    const provenance = {
      requested: pinned?.codexTools?.npm?.requested ?? selection.requested,
      package: selection.package,
      version: release,
      registry,
    };
    result.source = { ...result.source, ...provenance };
    result.completed = result.plan.slice(0, 2);
    result.remaining = result.plan.slice(2);

    staging = await realpath(await mkdtemp(path.join(tmpdir(), 'codex-tools-npm-')));
    const stageHome = path.join(staging, 'home');
    const stageCodex = path.join(staging, 'codex');
    const catalogFile = path.join(stageHome, '.agents/plugins/marketplace.json');
    await mkdir(path.dirname(catalogFile), { recursive: true });
    await mkdir(stageCodex);
    // Retain npm's user auth configuration when native acquisition changes HOME.
    const stageEnv = {
      ...registryEnv(env, provenance),
      HOME: stageHome,
      CODEX_HOME: stageCodex,
      npm_config_userconfig:
        env.npm_config_userconfig ?? env.NPM_CONFIG_USERCONFIG ?? path.join(context.home, '.npmrc'),
    };
    const stageOptions = { env: stageEnv, cwd: stageHome, timeoutMs: 120000 };
    let name = pinned?.name ?? 'codex-tools-identity-probe';
    const writeCatalog = () =>
      writeFile(
        catalogFile,
        JSON.stringify({
          name: 'inspection',
          plugins: [
            {
              name,
              source: { source: 'npm', package: selection.package, version: release, registry },
              policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
              category: 'Productivity',
            },
          ],
        }),
      );
    await writeCatalog();
    let installed = await native(
      ['plugin', 'add', '--json', '--', name + '@inspection'],
      stageOptions,
    );
    if (installed.exitCode !== 0 && !pinned) {
      // Codex 0.153.x exposes a manifest-name mismatch before installation. This is
      // only a discovery hint; the acquired manifest below is the identity authority.
      const discovered = installed.stderr.match(
        /plugin\.json name `([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)` does not match marketplace plugin name `codex-tools-identity-probe`/,
      );
      if (discovered && discovered[1].length <= 100) {
        name = discovered[1];
        await writeCatalog();
        installed = await native(
          ['plugin', 'add', '--json', '--', name + '@inspection'],
          stageOptions,
        );
      }
    }
    if (installed.exitCode !== 0) {
      result.exitCode = installed.exitCode || 2;
      throw new Error(npmFailure(installed, 'Native package inspection'));
    }
    let data;
    try {
      data = JSON.parse(installed.stdout);
    } catch {
      throw new Error('Native package inspection returned invalid JSON.');
    }
    if (
      typeof data.version !== 'string' ||
      !data.version ||
      ['.', '..'].includes(data.version) ||
      /[/\\]/.test(data.version) ||
      [...data.version].some((char) => char.charCodeAt(0) < 32) ||
      data.name !== name ||
      data.pluginId !== name + '@inspection' ||
      typeof data.installedPath !== 'string' ||
      !inside(stageCodex, data.installedPath) ||
      (await realpath(data.installedPath)) !== data.installedPath
    )
      throw new Error('Native inspection returned an unexpected package identity or path.');
    const source = await validateSource(data.installedPath, { portable: true });
    const pkg = JSON.parse(await readFile(path.join(source.root, 'package.json'), 'utf8'));
    if (
      source.manifest.name !== name ||
      pkg.name !== selection.package ||
      pkg.version !== release ||
      (source.manifest.version !== undefined && data.version !== source.manifest.version)
    )
      throw new Error(
        'Acquired package, manifest, or installed version does not match the selected release.',
      );
    source.npm = provenance;
    source.nativeVersion = data.version;
    result.source = {
      ...result.source,
      name,
      pluginVersion: data.version,
      valid: true,
      validation: 'basic installation prerequisites only; full plugin validation is not provided',
    };
    result.completed = result.plan.slice(0, 4);
    result.remaining = result.plan.slice(4);
    // Acquisition must not overwrite a marketplace changed while npm was running.
    if (
      !isDeepStrictEqual(await snapshot(context.catalogFile), context.catalogSnapshot) ||
      !isDeepStrictEqual(await snapshot(context.configFile), context.configSnapshot)
    )
      throw new Error(
        'Marketplace or Codex configuration changed during package inspection; rerun to replan.',
      );
    const completed = await performInstall(options, {
      env,
      native: safeNpmNative(native, provenance),
      source,
      refreshing,
    });
    completed.source = {
      ...completed.source,
      path: null,
      type: 'npm',
      pluginVersion: source.nativeVersion,
      ...provenance,
    };
    completed.acquisition = {
      method: 'native npm',
      prerequisites: 'checked',
      staging: 'removed',
      codexVersion: result.codexVersion,
      npmVersion: result.npmVersion,
    };
    return completed;
  } catch (error) {
    // Prerequisite errors contain our paths/field names, never raw npm output.
    if (error.source?.valid === false) result.source.valid = false;
    result.issue = error.message;
    result.exitCode ??= 2;
    result.acquisition = { method: 'native npm', staging: staging ? 'removed' : 'not-created' };
    return result;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}
