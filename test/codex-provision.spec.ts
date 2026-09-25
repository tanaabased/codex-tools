import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

import {
  codexAssetCache,
  provisionCodexCli,
  selectCodexAsset,
  type CodexAsset,
  type CodexFetcher,
} from '../lib/codex-provision.ts';
import type { NativeRunner } from '../lib/codex-native.ts';
import { supportedCodexVersion } from '../lib/codex-native.ts';

function archive(member: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(member, 0, 100, 'utf8');
  header.write('0000755\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('0', 156, 1, 'ascii');
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]));
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('lib/codex-provision', () => {
  let root = '';
  let body: Buffer;
  let payload: Buffer;
  let asset: CodexAsset;
  let native: NativeRunner;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codex-provision-test-'));
    body = Buffer.from('synthetic exact Codex executable');
    payload = archive('codex-test-target', body);
    asset = {
      platform: 'linux',
      arch: 'x64',
      target: 'test-target',
      archive: 'codex-test-target.tar.gz',
      member: 'codex-test-target',
      url: 'https://example.invalid/codex-test-target.tar.gz',
      sha256: digest(payload),
    };
    native = async (argv, options = {}) => {
      assert.deepEqual(argv, ['--version']);
      assert.ok(options.executable);
      const executable = await readFile(options.executable);
      return {
        argv,
        exitCode: 0,
        stdout: executable.equals(body)
          ? 'codex-cli ' + supportedCodexVersion
          : 'codex-cli 999.0.0',
        stderr: '',
      };
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should select pinned macOS and Linux assets for arm64 and x64', () => {
    assert.equal(selectCodexAsset('darwin', 'arm64').target, 'aarch64-apple-darwin');
    assert.equal(selectCodexAsset('darwin', 'x64').target, 'x86_64-apple-darwin');
    assert.equal(selectCodexAsset('linux', 'arm64').target, 'aarch64-unknown-linux-musl');
    assert.equal(selectCodexAsset('linux', 'x64').target, 'x86_64-unknown-linux-musl');
    assert.throws(() => selectCodexAsset('win32', 'x64'), /unavailable for win32\/x64/);
  });

  it('should download, verify, promote, and reuse a cached executable offline', async () => {
    let downloads = 0;
    const fetcher: CodexFetcher = async () => {
      downloads += 1;
      return new Response(payload);
    };
    const env = { HOME: root, PATH: path.join(root, 'host-codex-999') };
    const executable = await provisionCodexCli({ env, asset, fetcher, native });
    assert.equal(executable, path.join(codexAssetCache(asset, env), 'codex'));
    assert.deepEqual(await readFile(executable), body);
    assert.equal(downloads, 1);

    const offline: CodexFetcher = async () => {
      throw new Error('network must not be used');
    };
    assert.equal(await provisionCodexCli({ env, asset, fetcher: offline, native }), executable);
    assert.equal(downloads, 1);
  });

  it('should rebuild a corrupt executable from its valid cached archive offline', async () => {
    const env = { XDG_CACHE_HOME: root };
    const fetcher: CodexFetcher = async () => new Response(payload);
    const executable = await provisionCodexCli({ env, asset, fetcher, native });
    await writeFile(executable, 'corrupt');
    const offline: CodexFetcher = async () => {
      throw new Error('network must not be used');
    };

    assert.equal(await provisionCodexCli({ env, asset, fetcher: offline, native }), executable);
    assert.deepEqual(await readFile(executable), body);
  });

  it('should reject an unavailable or digest-mismatched asset without promoting it', async () => {
    const env = { HOME: root };
    await assert.rejects(
      provisionCodexCli({
        env,
        asset,
        fetcher: async () => new Response(null, { status: 404 }),
        native,
      }),
      /asset is unavailable: HTTP 404/,
    );
    await assert.rejects(
      provisionCodexCli({
        env,
        asset,
        fetcher: async () => new Response('wrong archive'),
        native,
      }),
      /failed SHA-256 verification/,
    );
    assert.deepEqual(await readdir(codexAssetCache(asset, env)), []);
  });

  it('should reject a digest-valid archive without the expected executable', async () => {
    const invalid = Buffer.from('not a gzip archive');
    await assert.rejects(
      provisionCodexCli({
        env: { HOME: root },
        asset: { ...asset, sha256: digest(invalid) },
        fetcher: async () => new Response(invalid),
        native,
      }),
      /archive is invalid/,
    );
    assert.deepEqual(await readdir(codexAssetCache(asset, { HOME: root })), []);
  });

  it('should tolerate concurrent verified promotion of the same immutable asset', async () => {
    const env = { HOME: root };
    let downloads = 0;
    const fetcher: CodexFetcher = async () => {
      downloads += 1;
      return new Response(payload);
    };
    const executables = await Promise.all([
      provisionCodexCli({ env, asset, fetcher, native }),
      provisionCodexCli({ env, asset, fetcher, native }),
    ]);
    assert.equal(new Set(executables).size, 1);
    assert.ok(downloads >= 1);
    assert.deepEqual(await readFile(executables[0]!), body);
  });
});
