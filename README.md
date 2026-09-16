# Codex Tools

One Bun ESM package for local Codex plugin installation, cache checks, synchronization, and diagnostics.
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
exports outside the checkout. Nothing is published. Node/npm are needed only for that
package check and Leia, not for the shipped CLI. There is no TypeScript layer.

PR checks run lint/format, unit and package tests, and the Leia scenarios in `examples/`
against the built executable. Local Leia runs require an explicit request.

## Commands

```sh
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin
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
These are installation prerequisites, not full plugin validation: C2 was withdrawn
and full validation moved to [Actions tooling](https://github.com/tanaabased/actions/issues/5).

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
version is reported for explicit native removal/reinstallation; this command is not
refresh. Native operations are bounded to 30 seconds each and use argument arrays.

JSON reports `completed`, `remaining`, child stdout/stderr/exit status, and installation
readback. A partial failure keeps completed setup so a repeat command can resume;
a failed native operation may itself have changed state. Native child failures retain
their exit code, overriding the general exit table above. Successful installation
means Codex reports the selected source installed; `enabled` is separate, and neither
authentication nor activation in an active task is inferred. Unknown stays unknown.

Run the bounded, credential-free native check explicitly with `bun run test:native`.
It uses disposable `HOME` and `CODEX_HOME`, checks cached skill bytes and repeat-install
immutability, and removes its fixtures. It does not use the operator's Codex home.

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
Acquisition from remote sources remains outside this local-install command.

Consumer wrappers can import `runOperation(command, options)`, `resolveContext`,
or `runCLI(argv, {env, stdout, stderr})` from `@tanaab/codex-tools`.
`runCLI` returns an exit code without setting process state; `runOperation` returns
the same normalized result used by JSON output. Options include `repoRoot`,
`cachePathOverride`, `codexHome`, `marketplace`, `managedPaths`, `excludeNames`,
`missingTarget`, `absentCheck`, and `dryRun`. Low-level tree functions are also
exported; wrappers should use `runOperation` to retain installation checks.
Install also accepts `marketplacePath`; cache-only options are rejected for install.
Consumer entrypoint migrations remain separate work.

## Extraction evidence

- Canon's snapshot/diff/sync engine and overlap/link tests are adapted in `lib/cache.js`,
  `utils/diff-entries.js`, and `test/cache-canon.spec.js`.
- Me's scoped collection, ENOENT-only handling, unchanged-file behavior, and runtime-input
  tests are retained in the shared engine and `test/cache-managed.spec.js`.
- Agentbox's installation inspection and neutral-check/strict-sync semantics are adapted
  in `lib/context.js`, `lib/operations.js`, and `test/operations.spec.js`.
- Repository-specific paths, marketplace constants, version-directory assumptions,
  and duplicated parsers/reporters are replaced by consumer settings and one CLI boundary.
  `test/cli.spec.js` checks actual output and exit status; `test/cache-safety.spec.js`
  covers scoped-parent links, exclusions, and dry-run effects.

The current canonical ESLint and Bun CLI templates matched the issue's pinned versions
when extracted. The scaffold follows Merge's one-package baseline; the CLI separates
entrypoint, parser, help, and presentation as in the pinned Leia implementation.
Source commits and license notices are recorded in `NOTICE`.

### Installation reconciliation

- Reused Me's `ensure_plugin_link_for_checkout` and `resolve_symlink_dir_target`
  safeguards: resolve link identity, preserve matching mappings, refuse unrelated links
  and regular-file collisions. The pinned functions still matched current source at
  implementation; the current catalog additionally contains an npm entry, which is
  preserved rather than converted. `test/install.spec.js` adapts those preservation
  expectations without running Me's machine bootstrap.
- Retained C1's cache engine, compatibility settings, and tests unchanged. Installation
  is a separate orchestration boundary in `lib/install.js` and `lib/install-context.js`.
- Inspected the shipped Plugin Creator `create_basic_plugin.py` and
  `read_marketplace_name.py`: retained their catalog shape and default entry policies;
  replaced whole-entry overwrite with append-or-preserve reconciliation. No Python
  scaffolder, bootstrap, Stow orchestration, or hardcoded consumer identity is imported.
- Me's stale-link cleanup and absolute-link normalization are deliberately not installation
  operations: a name/source collision requires an explicit decision, and a matching
  absolute link is already usable. Native Codex owns cache installation and enablement.
