# Codex Tools

One Bun ESM package for local and npm Codex plugin installation, refresh, cache checks, synchronization, and diagnostics.
Requires Bun 1.3.14 or newer. Release publication and plugin packaging are separate work.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev --help
bun run lint
bun run test
bun run build
bun run test:package
```

The declared executable is `dist/codex-tools`; build before packing. Package smoke inspects
`npm pack --dry-run`, creates a disposable local tarball, and runs its executable and
exports outside the checkout. Nothing is published. The shipped CLI runs on Bun; cache
commands do not invoke Codex. Local install and refresh require Codex 0.153.x, while their
npm variants also require npm. The package check uses Node, npm, and tar. There is no
TypeScript layer.

PR checks run lint/format, unit and package tests, and the Leia scenarios in `examples/`
against the built executable. Local Leia runs require an explicit request.

## Commands

```sh
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin
codex-tools refresh /path/to/plugin --dry-run --json
codex-tools refresh /path/to/plugin
codex-tools status --repo-root /path/to/plugin --codex-home /path/to/codex --json
codex-tools cache check --repo-root /path/to/plugin --marketplace my-market
codex-tools cache sync --repo-root /path/to/plugin --dry-run
codex-tools cache sync --repo-root /path/to/plugin
```

`doctor` aliases `status`. Read-only commands do not repair anything. See `--help` for
flags and environment variables. Explicit flags beat environment variables, which beat
repository settings and defaults. Unknown/repeated flags, missing values, invalid
commands, and extra arguments fail before filesystem effects. JSON stdout contains one
undecorated value; diagnostics and debug go to stderr.

| Exit | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | Current, synchronized, valid dry run, help/version, or explicitly neutral absence     |
| 1    | Drift, unavailable/incompatible installation, ambiguous target, or failed convergence |
| 2    | Invalid arguments, source/configuration errors, or filesystem failure                 |

## Local installation

`install [plugin-path]` defaults to the current directory and delegates to native
`codex plugin add`. It supports the Codex **0.153.x** CLI contract, verified with
**0.153.4**. Other versions fail before marketplace edits. The source needs a
`.codex-plugin/plugin.json`, not `package.json`; installation checks identity and
declared skills/apps/MCP resource paths without executing source-owned scripts.
These are installation prerequisites, not full plugin validation. No Python validator
or JavaScript port is required; Actions tooling is not an installation dependency.

By default, the command reads or creates `~/.agents/plugins/marketplace.json`.
Its existing name is retained; a new personal catalog uses `personal`. Codex resolves
catalog source paths from `~`, **not** from the catalog's directory. An external
source gets a relative `~/plugins/<name>` symlink. Matching entries and links stay
untouched, including display metadata, policies, and entry order. Other entries
are preserved; new entries are appended with `AVAILABLE` / `ON_INSTALL` policy.
Files, unrelated/dangling links, conflicting names or sources, and blocked installation
policy are never silently replaced. A missing mapping for an existing matching
local entry is created at that entry's declared path.

To select another local marketplace, pass its catalog path (the root must exist):

```sh
codex-tools install /path/to/plugin --marketplace team \
  --marketplace-path /path/to/market/.agents/plugins/marketplace.json --dry-run
codex-tools install /path/to/plugin --marketplace team \
  --marketplace-path /path/to/market/.agents/plugins/marketplace.json
# Subsequent calls can resolve the registered local source by name:
codex-tools install /path/to/plugin --marketplace team
```

Personal discovery needs no registration. Explicit local roots are registered only
when necessary, **after** their catalog is generated. `--codex-home` selects Codex's
configuration and cache; the personal catalog still belongs to `HOME`. Install does
not consume source-owned cache compatibility settings. Files used for metadata must
be singly linked regular files and marketplace mapping/catalog parents must be real
directories; linked metadata or parent directories fail with a path-specific error.
Use a regular local catalog root when a dotfile manager supplies linked metadata.

Dry run starts no native process and writes nothing. Its `plan` lists directory
creation, mapping, catalog contents, registration, native argv, and the conditional
install. Execution checks for intervening changes. A same-source/version installation
is read back and left unchanged, including a disabled state. A different installed
version is reported for `refresh`; install itself does not refresh existing payloads.
Native operations are bounded to 30 seconds each and use argument arrays.

JSON reports `completed`, `remaining`, child stdout/stderr/exit status, and installation
readback. A partial failure keeps completed setup so a repeat command can resume;
a failed native operation may itself have changed state. Native child failures retain
their exit code, overriding the general exit table above. Successful installation
means Codex reports the selected source installed; `enabled` is separate, and neither
authentication nor activation in an active task is inferred. Unknown stays unknown.

Run the bounded, credential-free native check explicitly with `bun run test:native`.
It uses disposable `HOME` and `CODEX_HOME`, checks cached skill bytes, repeat-install
immutability, successive/stale refreshes, source-mapping rejection, unrelated-state
preservation, and recovery after a real native cache-write failure. It removes its
fixtures and does not use the operator's Codex home.

## npm installation and refresh

```sh
codex-tools install npm:@scope/plugin@1.2.3
codex-tools install 'npm:@scope/plugin@^1.2.0' --dry-run --json
codex-tools install npm:plugin@stable --marketplace team
codex-tools refresh npm:@scope/plugin
```

`install npm:<package>[@<version|tag|range>]` accepts scoped and unscoped names;
no selector means `latest`. Quote ranges containing shell characters or spaces.
Local paths, including `./npm:local`, retain their existing behavior. npm aliases,
Git/URL/path acquisition, empty selectors, and malformed input are rejected.

npm must be on `PATH`. Registry selection uses npm's scoped/default configuration;
registries must use HTTPS without embedded credentials, queries, or fragments.
Keep authentication in npm user configuration or npm environment settings. Codex
runs acquisition outside the project directory, so project-only `.npmrc` authentication
is not sufficient. No registry credentials are copied into catalog provenance.

The installer resolves an exact npm release, then asks Codex to acquire it in a
disposable home. Codex 0.153.x reports a manifest-name mismatch when the inspection
entry has a provisional name; the installer uses that bounded discovery hint for
one retry and reads the acquired manifest to establish the actual identity. It
never assumes the package name equals the plugin name. Native npm acquisition and
extraction remain Codex's responsibility; there is no custom downloader or
fetch-then-local fallback. Package lifecycle scripts are disabled by native Codex.

Basic JavaScript checks cover manifest identity, declared resource existence/type,
and path containment. Unknown optional metadata is not rejected. These checks do
not certify skill behavior, arbitrary script dependencies, or MCP connectivity.
Both legacy `.codex-plugin/plugin.json` and recognized portable `plugin.json`
manifests are inspected for npm payloads; local-path installation is unchanged.

Only after inspection does the existing personal/explicit marketplace workflow
write an npm-backed entry. It pins `source.version` to the **package** release and
records the requested selector, registry, package version, and separate plugin
name/version under `codexTools.npm`. Conflicting identities or sources fail;
unrelated entries and metadata remain intact. A native install followed by
identity/version and cached-payload readback is required for success.

Repeating the same request leaves an unchanged catalog and matching installed
payload untouched. A new `install` request can explicitly select another release,
including a moved tag. `refresh npm:<package>` instead reads the existing exact
pin: it does not resolve `latest`, edit a manifest/cachebuster, or upgrade. An
explicit refresh version must equal the pin; tags/ranges are rejected for refresh.
Disabled installations remain disabled on repeat install; refresh, repair, or a
release change requires explicit enablement first because native add enables them.

Dry run starts **no subprocesses and makes no writes**. It reports unresolved
registry/version/identity and payload checks as pending instead of pretending
that resolution occurred. Execution reports completed/remaining operations and
partial effects; failures do not roll back earlier marketplace/native writes.
Raw npm and native npm failure output is withheld because it can echo credentials;
diagnostics retain the exit code, recognized npm error category, and recovery hint.
`installed`/`refreshed` describe verified disk state, not activation in an existing
conversation. Start a new Codex conversation for refreshed skills and tools.

Compatibility was exercised with **Codex 0.153.0 and 0.153.4, and npm 11.19.0**. The supported
contract remains Codex **0.153.x**; other versions fail before marketplace edits.
Run `bun run test:native:npm` with `codex`, `npm`, `openssl`, and `tar` available to
repeat the disposable HTTPS-registry fixture. It checks native npm acquisition,
differing package/plugin identities and versions, exact/tag/range resolution,
repeat installs, pinned refresh, malformed/incomplete payload rejection, unrelated
entry preservation, disabled lifecycle scripts, and skill discovery in a fresh
Codex app-server process. It does not run a model-backed behavioral evaluation.

## Local refresh

`refresh [plugin-path]` defaults to the current directory. It requires an existing
installation and a matching local marketplace entry; it does not create mappings,
register marketplaces, repair collisions, or acquire remote sources. Personal discovery
is the default; `--marketplace` and `--marketplace-path` select an existing registered
local marketplace as for install. Missing, ambiguous, mismatched, or nonlocal state
fails before source edits. A stale installed version is allowed.

For Codex **0.153.x** (tested with **0.153.4**), refresh atomically rewrites the source
manifest version, then delegates to `codex plugin add` without removing the old
installation or copying into its cache. It follows the shipped Plugin Creator helper:
preserve everything before the first `+`, replace the suffix with
`+codex.<YYYYMMDDhhmmss>` in UTC, and leave release numbers alone. To avoid same-second
collisions, advance the timestamp by seconds until it differs from the source version
and existing cache directories. Manifest formatting becomes two-space JSON plus a
newline. Review this source edit before committing the plugin itself.

Dry run writes nothing and starts no native process. It reports the proposed manifest
before/after versions, native argv, and pending checks; it is not proof of an installed
or enabled plugin. Execution checks native identity and enablement before editing.
Native `add` enables disabled plugins, so refresh refuses disabled installations;
enable the plugin explicitly in Codex first. Native copying skips symlinks, so refresh
also refuses payload symlinks rather than claim a complete install. The source mapping
itself may be a symlink. Cache parent directories must not be symlinks.

Verification compares installed identity and the expected cache path, then files,
bytes, modes, directories, and extra entries against a stable source snapshot. It reuses
the whole-tree collector's `.git`, `node_modules`, and `.DS_Store` exclusions; cache
consumer selection settings do not narrow native refresh verification. It checks that
the selected catalog/mapping, Codex configuration values, and other installed records
in the selected marketplace remain unchanged. Concurrent source/state changes or
incomplete readback produce `incomplete`, not success.

JSON includes `manifestEdit`, `effects`, `inspection.phase`, payload verification,
`completed`/`remaining`, and native child results. On failure, an applied cachebuster
stays in the source; a failed native reinstall may also have changed state. There is no
automatic rollback or deletion of old cache versions. Inspect the reported effects,
resolve the error, and rerun. Native failures retain their child exit code.

`refreshed` means verified **on disk**, not activated in an existing task. Start a new
Codex task to pick up refreshed skills and tools; restart Codex if they remain unavailable.
Authentication and existing-task pickup remain unknown. Use `cache sync` separately
when direct copying, including its scoped payload and link semantics, is wanted.

## Consumer configuration

For cache commands, the source must contain `package.json` with a version and `.codex-plugin/plugin.json`
with a name. Plugin manifest version is the exact compatibility identity; package
version is the fallback when the source manifest omits it. These are distinct from
the cache directory's name.

Declare payload scope in the source's `package.json`:

```json
{
  "codexTools": {
    "managedPaths": [".codex-plugin", "package.json", "skills", "references", "scripts"],
    "excludeNames": [],
    "missingTarget": "require-installed",
    "absentCheck": "fail"
  }
}
```

Omit `managedPaths` (or set it to `null`) for Canon-style whole-tree selection.
Managed paths may be files or directories, including nested leaves. Include all runtime
inputs used by installed skills. `.git`, `node_modules`, and `.DS_Store` are excluded
at every depth; `excludeNames` adds consumer-owned basename exclusions. Unmanaged
siblings and excluded content survive sync. A type replacement that would destroy
excluded content fails. Scoped leaves with symlink/non-directory parents fail rather
than writing through them.

Default sync requires a matching manifest in the selected Codex home's
`plugins/cache/<marketplace>/<plugin>/<directory>` layout. Discovery selects only one
exact manifest match. It never assumes that package version equals directory name,
chooses a newest version, or guesses among multiple matches. Use `--marketplace`
and/or `--cache-path` to resolve ambiguity. Unsupported/aliased installations are
not write targets.

Diagnostics report source identity, selected home/marketplace/path, candidate cached
versions (including invalid manifests), exact compatibility, and drift. `installed`
means a verified cache identity in the supported layout, **not** proof the plugin is
enabled or active in a running Codex session. Registration and enabled state are
reported separately from the selected home's `config.toml`, or as unknown. Layered
project/admin policy and live-session activation are not inferred.

For Me/Canon-compatible raw-target creation, opt in explicitly:

```sh
codex-tools cache sync --repo-root /path/to/plugin --cache-path /tmp/payload --missing-target create --dry-run
codex-tools cache sync --repo-root /path/to/plugin --cache-path /tmp/payload --missing-target create
```

Creation requires an explicit target and reports `synchronized_directory`, never
`installed`. Agentbox-style callers keep `missingTarget: "require-installed"` and
set `absentCheck: "neutral"`; missing/invalid installations then pass checks but
still fail sync. Cache commands never install, register, or enable a plugin.
Arbitrary Git/URL acquisition remains outside the installer.

Consumer wrappers can import `runOperation(command, options)`, `resolveContext`,
or `runCLI(argv, {env, stdout, stderr})` from `@tanaab/codex-tools`.
`runCLI` returns an exit code without setting process state; `runOperation` returns
the same normalized result used by JSON output. Options include `repoRoot`,
`cachePathOverride`, `codexHome`, `marketplace`, `managedPaths`, `excludeNames`,
`missingTarget`, `absentCheck`, and `dryRun`. Low-level tree functions are also
exported; wrappers should use `runOperation` to retain installation checks.
Install and refresh also accept `marketplacePath` and `npmSelector` (mutually exclusive
with `repoRoot`); both reject cache-only options.
`refreshPlugin(options, runtime)` is exported for wrappers that need native refresh.
Consumer entrypoint migrations remain separate work.
