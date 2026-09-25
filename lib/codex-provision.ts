import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { asError } from '../utils/errors.ts';
import {
  assertSupportedCodexVersion,
  readNativeResult,
  runNative,
  supportedCodexVersion,
} from './codex-native.ts';
import type { NativeRunner } from './codex-native.ts';

const unzip = promisify(gunzip);

export interface CodexAsset {
  platform: string;
  arch: string;
  target: string;
  archive: string;
  member: string;
  url: string;
  sha256: string;
}

export type CodexFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface CodexProvisionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  arch?: string;
  asset?: CodexAsset;
  fetcher?: CodexFetcher;
  native?: NativeRunner;
}

interface IntegrityRecord {
  version: string;
  asset: string;
  archiveSha256: string;
  executableSha256: string;
}

const release = 'https://github.com/openai/codex/releases/download/rust-v' + supportedCodexVersion;
const assets: Record<string, Omit<CodexAsset, 'platform' | 'arch'>> = {
  'darwin-arm64': {
    target: 'aarch64-apple-darwin',
    archive: 'codex-aarch64-apple-darwin.tar.gz',
    member: 'codex-aarch64-apple-darwin',
    url: release + '/codex-aarch64-apple-darwin.tar.gz',
    sha256: '344310a0a591c1b192e04feff304321a69907c9498baaac331ca7e16ebcef9d7',
  },
  'darwin-x64': {
    target: 'x86_64-apple-darwin',
    archive: 'codex-x86_64-apple-darwin.tar.gz',
    member: 'codex-x86_64-apple-darwin',
    url: release + '/codex-x86_64-apple-darwin.tar.gz',
    sha256: '1219c837d8f813b493a424c125c0038b5d9ca16279bc6d3fe6ce037a3e18a6e7',
  },
  'linux-arm64': {
    target: 'aarch64-unknown-linux-musl',
    archive: 'codex-aarch64-unknown-linux-musl.tar.gz',
    member: 'codex-aarch64-unknown-linux-musl',
    url: release + '/codex-aarch64-unknown-linux-musl.tar.gz',
    sha256: '583b48df32804213bdcd338c2e5adb06b34340821fa757a726cc0a524fa33c27',
  },
  'linux-x64': {
    target: 'x86_64-unknown-linux-musl',
    archive: 'codex-x86_64-unknown-linux-musl.tar.gz',
    member: 'codex-x86_64-unknown-linux-musl',
    url: release + '/codex-x86_64-unknown-linux-musl.tar.gz',
    sha256: 'd7e18b2597ae8f242f5f31ee9e90deef48dbc9edd634d9868fb6435d08c07f02',
  },
};

/** selects the pinned official release asset for one supported host. */
export function selectCodexAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): CodexAsset {
  const asset = assets[platform + '-' + arch];
  if (!asset)
    throw new Error(
      'Managed Codex CLI ' +
        supportedCodexVersion +
        ' is unavailable for ' +
        platform +
        '/' +
        arch +
        '; supported hosts are macOS and Linux on arm64 or x64.',
    );
  return { platform, arch, ...asset };
}

/** returns the user cache directory for one pinned asset. */
export function codexAssetCache(asset: CodexAsset, env: NodeJS.ProcessEnv = process.env): string {
  const selected = env.XDG_CACHE_HOME?.trim();
  const home = env.HOME?.trim();
  if (selected && !path.isAbsolute(selected))
    throw new Error('XDG_CACHE_HOME must be an absolute path to provision the managed Codex CLI.');
  if (!selected && (!home || !path.isAbsolute(home)))
    throw new Error('HOME must be an absolute path to provision the managed Codex CLI.');
  const root = selected ?? path.join(home!, '.cache');
  return path.join(root, 'codex-tools', 'codex', supportedCodexVersion, asset.target);
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function tarString(block: Buffer, start: number, length: number): string {
  const value = block.subarray(start, start + length);
  const end = value.indexOf(0);
  return value
    .subarray(0, end < 0 ? value.length : end)
    .toString('utf8')
    .trim();
}

function tarSize(block: Buffer): number {
  const value = tarString(block, 124, 12);
  if (!/^[0-7]+$/.test(value)) throw new Error('invalid tar entry size');
  return Number.parseInt(value, 8);
}

async function extractExecutable(archive: Buffer, member: string): Promise<Buffer> {
  const tar = await unzip(archive);
  let executable: Buffer | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
    const size = tarSize(header);
    const content = offset + 512;
    const end = content + size;
    if (end > tar.length) throw new Error('truncated tar entry');
    const type = String.fromCharCode(header[156] ?? 0);
    if ((type === '\0' || type === '0') && (name === member || name === './' + member)) {
      if (executable) throw new Error('duplicate Codex executable');
      executable = Buffer.from(tar.subarray(content, end));
    }
    offset = content + Math.ceil(size / 512) * 512;
  }
  if (!executable?.length) throw new Error('missing Codex executable');
  return executable;
}

function integrity(value: unknown, asset: CodexAsset): IntegrityRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== supportedCodexVersion ||
    record.asset !== asset.archive ||
    record.archiveSha256 !== asset.sha256 ||
    typeof record.executableSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.executableSha256)
  )
    return null;
  return record as unknown as IntegrityRecord;
}

async function exactVersion(executable: string, native: NativeRunner): Promise<void> {
  const child = await native(['--version'], { executable, timeoutMs: 30000 });
  assertSupportedCodexVersion(
    readNativeResult(child, {
      json: false,
      failureMessage: 'Managed Codex CLI ' + supportedCodexVersion + ' failed its version check.',
    }),
    {
      unsupportedMessage:
        'Managed Codex CLI did not report exact version ' + supportedCodexVersion + '.',
    },
  );
}

async function cachedExecutable(
  executable: string,
  receipt: string,
  asset: CodexAsset,
  native: NativeRunner,
): Promise<string | null> {
  try {
    const record = integrity(JSON.parse(await readFile(receipt, 'utf8')) as unknown, asset);
    if (!record) return null;
    const body = await readFile(executable);
    if (sha256(body) !== record.executableSha256) return null;
    await exactVersion(executable, native);
    return executable;
  } catch {
    return null;
  }
}

async function cachedArchive(file: string, asset: CodexAsset): Promise<Buffer | null> {
  try {
    const archive = await readFile(file);
    if (sha256(archive) !== asset.sha256) return null;
    await extractExecutable(archive, asset.member);
    return archive;
  } catch {
    return null;
  }
}

async function downloadArchive(
  asset: CodexAsset,
  destination: string,
  fetcher: CodexFetcher,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(asset.url, { signal: AbortSignal.timeout(120000) });
  } catch (error) {
    throw new Error(
      'Managed Codex CLI ' +
        supportedCodexVersion +
        ' asset is unavailable: ' +
        asError(error).message,
      { cause: error },
    );
  }
  if (!response.ok || !response.body)
    throw new Error(
      'Managed Codex CLI ' +
        supportedCodexVersion +
        ' asset is unavailable: HTTP ' +
        response.status +
        '.',
    );
  const file = await open(destination, 'wx', 0o600);
  const digest = createHash('sha256');
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      digest.update(chunk.value);
      await file.write(chunk.value);
    }
  } finally {
    await file.close();
  }
  if (digest.digest('hex') !== asset.sha256)
    throw new Error(
      'Managed Codex CLI archive failed SHA-256 verification: ' + asset.archive + '.',
    );
  return readFile(destination);
}

async function promote(
  archive: Buffer,
  asset: CodexAsset,
  directory: string,
  archiveTemporary: string | null,
  native: NativeRunner,
): Promise<string> {
  let body: Buffer;
  try {
    body = await extractExecutable(archive, asset.member);
  } catch (error) {
    throw new Error('Managed Codex CLI archive is invalid: ' + asError(error).message + '.', {
      cause: error,
    });
  }
  const executable = path.join(directory, 'codex');
  const receipt = path.join(directory, 'integrity.json');
  const id = randomUUID();
  const executableTemporary = path.join(directory, '.codex.' + id + '.tmp');
  const receiptTemporary = path.join(directory, '.integrity.' + id + '.tmp');
  const record: IntegrityRecord = {
    version: supportedCodexVersion,
    asset: asset.archive,
    archiveSha256: asset.sha256,
    executableSha256: sha256(body),
  };
  try {
    const file = await open(executableTemporary, 'wx', 0o700);
    try {
      await file.write(body);
    } finally {
      await file.close();
    }
    await chmod(executableTemporary, 0o755);
    await exactVersion(executableTemporary, native);
    const receiptFile = await open(receiptTemporary, 'wx', 0o600);
    try {
      await receiptFile.writeFile(JSON.stringify(record) + '\n');
    } finally {
      await receiptFile.close();
    }
    if (archiveTemporary) await rename(archiveTemporary, path.join(directory, asset.archive));
    await rename(executableTemporary, executable);
    await rename(receiptTemporary, receipt);
    return executable;
  } finally {
    await rm(executableTemporary, { force: true });
    await rm(receiptTemporary, { force: true });
  }
}

/** provisions, verifies, and returns the exact managed Codex executable for this host. */
export async function provisionCodexCli({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  asset: providedAsset,
  fetcher = fetch,
  native = runNative,
}: CodexProvisionOptions = {}): Promise<string> {
  const asset = providedAsset ?? selectCodexAsset(platform, arch);
  const directory = codexAssetCache(asset, env);
  const executable = path.join(directory, 'codex');
  const receipt = path.join(directory, 'integrity.json');
  const archiveFile = path.join(directory, asset.archive);
  await mkdir(directory, { recursive: true });
  const cached = await cachedExecutable(executable, receipt, asset, native);
  if (cached) return cached;
  const archive = await cachedArchive(archiveFile, asset);
  if (archive) return promote(archive, asset, directory, null, native);
  const temporary = path.join(directory, '.' + asset.archive + '.' + randomUUID() + '.tmp');
  try {
    const downloaded = await downloadArchive(asset, temporary, fetcher);
    return await promote(downloaded, asset, directory, temporary, native);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** provisions one executable and binds every native command in an operation to it. */
export async function provisionNativeRunner(env: NodeJS.ProcessEnv): Promise<NativeRunner> {
  const executable = await provisionCodexCli({ env });
  return (argv, options = {}) => runNative(argv, { ...options, executable });
}
