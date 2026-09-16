import { spawn } from 'node:child_process';
import { link, lstat, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { object, optional, resolveInstall, snapshot } from './install-context.js';

export async function runNative(argv, { env, cwd }) {
  return new Promise((resolve) => {
    const child = spawn('codex', argv, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ argv, exitCode: 2, stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ argv, exitCode: code ?? 1, signal, stdout, stderr });
    });
  });
}

export async function installPlugin(options = {}, { env = process.env, native = runNative } = {}) {
  const context = await resolveInstall(options, env);
  const { source, root, home, codexHome, catalog, catalogFile, mapping } = context;
  const pluginId = source.manifest.name + '@' + catalog.name;
  const nativeOptions = { env: { ...env, HOME: home, CODEX_HOME: codexHome }, cwd: home };
  const result = {
    command: 'install',
    source: {
      path: source.root,
      valid: true,
      name: source.manifest.name,
      version: source.manifest.version ?? null,
      validation: 'installation prerequisites only; full validation belongs to Actions tooling',
    },
    codexHome,
    marketplace: catalog.name,
    marketplaceRoot: root,
    catalogPath: catalogFile,
    mapping: { path: mapping, target: source.root },
    pluginId,
    dryRun: Boolean(options.dryRun),
    ok: false,
    status: 'planned',
    issue: null,
    inspection: {
      installed: false,
      enabled: null,
      authentication: 'unknown',
      activation: 'unknown',
    },
    plan: [],
    completed: [],
    remaining: [],
    native: [],
  };
  const step = (operation, extra = {}) => result.plan.push({ operation, ...extra });
  step('preflight', { argv: ['--version'] });
  if (context.createCodexHome) step('create-codex-home', { path: codexHome });
  step('inspect-marketplaces', { argv: ['plugin', 'marketplace', 'list', '--json'] });
  step('inspect-installation', {
    argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name],
  });
  for (const directory of context.directories) step('mkdir', { path: directory });
  if (context.addMapping)
    step('map-source', {
      path: mapping,
      target: path.relative(path.dirname(mapping), source.root),
    });
  if (context.editCatalog) step('write-catalog', { path: catalogFile, catalog });
  if (context.register)
    step('register-marketplace', { argv: ['plugin', 'marketplace', 'add', root, '--json'] });
  step('verify-marketplace', { argv: ['plugin', 'marketplace', 'list', '--json'] });
  step('install', {
    argv: ['plugin', 'add', '--json', '--', pluginId],
    condition: 'unless the same source/version is already installed',
  });
  step('readback', { argv: ['plugin', 'list', '--json', '--marketplace=' + catalog.name] });
  result.remaining = [...result.plan];
  if (options.dryRun) {
    result.ok = true;
    return result;
  }
  let expectedCatalog = context.catalogSnapshot;
  let expectedConfig = context.configSnapshot;
  let expectedMapping = context.mappingStats;
  let installed;
  async function unchanged() {
    for (const [file, expected] of [
      [source.file, source.original],
      [catalogFile, expectedCatalog],
      [context.configFile, expectedConfig],
    ]) {
      if (JSON.stringify(await snapshot(file)) !== JSON.stringify(expected))
        throw new Error('File changed during installation; rerun to replan: ' + file);
    }
    if ((await realpath(root)) !== root || (await realpath(source.root)) !== source.root)
      throw new Error('Source or marketplace root changed during installation.');
    for (const target of [path.dirname(mapping), path.dirname(catalogFile)]) {
      let current = root;
      for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const stats = await optional(() => lstat(current));
        if (stats && !stats.isDirectory())
          throw new Error('Marketplace parent changed: ' + current);
      }
    }
    const stats = await optional(() => lstat(mapping));
    if (
      expectedMapping
        ? !stats ||
          stats.ino !== expectedMapping.ino ||
          stats.dev !== expectedMapping.dev ||
          (await realpath(mapping)) !== source.root
        : stats
    )
      throw new Error('Source mapping changed during installation.');
  }
  async function call(argv, json = true) {
    const child = await native(argv, nativeOptions);
    result.native.push(child);
    if (child.exitCode !== 0) {
      result.nativeError = child;
      result.exitCode = child.exitCode;
      throw new Error(child.error ?? (child.stderr.trim() || 'Native Codex command failed.'));
    }
    if (!json) return child.stdout.trim();
    try {
      return JSON.parse(child.stdout);
    } catch {
      throw new Error('Native Codex returned invalid JSON.');
    }
  }
  async function markets(argv, required) {
    const data = await call(argv);
    if (!Array.isArray(data?.marketplaces))
      throw new Error('Unsupported native marketplace readback.');
    const matches = data.marketplaces.filter((market) => market.name === catalog.name);
    if (matches.length > 1 || (required && matches.length !== 1))
      throw new Error('Selected marketplace is missing or ambiguous in Codex.');
    if (
      matches.length &&
      (typeof matches[0].root !== 'string' ||
        (await realpath(matches[0].root)) !== root ||
        (matches[0].marketplaceSource && matches[0].marketplaceSource.sourceType !== 'local'))
    )
      throw new Error('Native marketplace name/source collision.');
  }
  async function readback(argv) {
    const data = await call(argv);
    if (!Array.isArray(data?.installed))
      throw new Error('Unsupported native installation readback.');
    const matches = data.installed.filter((plugin) => plugin.pluginId === pluginId);
    if (matches.length > 1) throw new Error('Ambiguous native installation readback.');
    const found = matches[0];
    if (found) {
      if (typeof found.installed !== 'boolean' || typeof found.enabled !== 'boolean')
        throw new Error('Unsupported native installation state.');
      if (
        found.name !== source.manifest.name ||
        found.marketplaceName !== catalog.name ||
        !object(found.source) ||
        found.source.source !== 'local' ||
        typeof found.source.path !== 'string' ||
        (await realpath(found.source.path)) !== source.root
      )
        throw new Error('Installed plugin source does not match selected source.');
      if (source.manifest.version !== undefined && found.version !== source.manifest.version)
        throw new Error(
          'Another version is installed; use codex-tools refresh to reinstall the local source.',
        );
    }
    return found;
  }
  try {
    for (const operation of result.plan) {
      await unchanged();
      switch (operation.operation) {
        case 'preflight': {
          const version = await call(operation.argv, false);
          result.codexVersion = version;
          if (!/^codex-cli 0\.153\.\d+$/.test(version))
            throw new Error('Supported native contract is Codex 0.153.x; found ' + version);
          break;
        }
        case 'create-codex-home':
          await mkdir(codexHome, { recursive: true });
          break;
        case 'inspect-marketplaces':
          await markets(operation.argv, false);
          break;
        case 'inspect-installation':
          installed = await readback(operation.argv);
          break;
        case 'mkdir':
          await mkdir(operation.path);
          break;
        case 'map-source': {
          await symlink(operation.target, mapping, 'dir');
          const stats = await lstat(mapping);
          expectedMapping = { ino: stats.ino, dev: stats.dev };
          break;
        }
        case 'write-catalog': {
          const temporary = catalogFile + '.' + randomUUID() + '.tmp';
          try {
            await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n', {
              flag: 'wx',
              mode: expectedCatalog?.mode ?? 0o644,
            });
            await unchanged();
            if (expectedCatalog) await rename(temporary, catalogFile);
            else {
              // Exclusive creation keeps an intervening catalog from being replaced.
              await link(temporary, catalogFile);
              await rm(temporary);
            }
            expectedCatalog = await snapshot(catalogFile);
          } finally {
            await rm(temporary, { force: true });
          }
          break;
        }
        case 'register-marketplace':
          await mkdir(codexHome, { recursive: true });
          await call(operation.argv);
          expectedConfig = await snapshot(context.configFile);
          break;
        case 'verify-marketplace':
          await markets(operation.argv, true);
          break;
        case 'install':
          if (installed?.installed === true) {
            operation.skipped = true;
            break;
          }
          await mkdir(codexHome, { recursive: true });
          await call(operation.argv);
          expectedConfig = await snapshot(context.configFile);
          break;
        case 'readback': {
          installed = await readback(operation.argv);
          result.inspection = {
            installed: installed?.installed === true,
            enabled: installed?.enabled ?? null,
            authentication: 'unknown',
            authPolicy: installed?.authPolicy ?? null,
            activation: 'unknown',
          };
          if (!result.inspection.installed)
            throw new Error('Native install completed but installation was not observed.');
          break;
        }
      }
      result.completed.push(operation);
      result.remaining = result.plan.slice(result.completed.length);
    }
    result.ok = true;
    result.status =
      result.inspection.enabled === true ? 'installed' : 'installed_pending_enablement';
    result.issue =
      'Authentication and activation in an active Codex task are not observable through this native CLI.';
  } catch (error) {
    result.status = 'incomplete';
    if (['install', 'register-marketplace'].includes(result.remaining[0]?.operation))
      result.nativeState =
        'The failed native operation may have changed Codex state; rerun to inspect and resume.';
    result.issue = error.message;
    result.exitCode ??= 2;
  }
  return result;
}
