# Codex Tools

One Bun ESM package for local Codex plugin cache checks, synchronization, diagnostics, and plugin validation.
Requires Bun 1.3.14 or newer. Release publication and plugin packaging are separate work.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev --help
python3 -m venv .temp/validation-venv
.temp/validation-venv/bin/python -m pip install -r vendor/openai/requirements.txt
export CODEX_TOOLS_PYTHON="$PWD/.temp/validation-venv/bin/python"
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
codex-tools validate --repo-root /path/to/plugin --json
codex-tools status --repo-root /path/to/plugin --codex-home /path/to/codex --json
codex-tools cache check --repo-root /path/to/plugin --marketplace my-market
codex-tools cache sync --repo-root /path/to/plugin --dry-run
codex-tools cache sync --repo-root /path/to/plugin
```

`doctor` aliases `status`. Read-only commands do not repair anything. See `--help` for
flags and environment variables. Explicit flags beat environment variables, which beat
repository settings and defaults. Unknown/repeated flags, missing values, invalid
commands, and extra arguments fail before filesystem effects. JSON stdout contains one
undecorated value; debug goes to stderr. Validation captures child diagnostics in its report.
See [validation](validation.md) for Python/PyYAML setup, pinned contract coverage, and
explicit repository integration. Validation requires no cache or package.json.

| Exit | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 0    | Current, synchronized, valid plugin/dry run, help/version, or explicitly neutral absence                  |
| 1    | Drift, unavailable/incompatible installation, ambiguous target, failed convergence, or validation failure |
| 2    | Invalid arguments, source/configuration errors, missing validation dependencies, or filesystem failure    |

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
still fail sync. No command installs, registers, enables, fetches, or refreshes a
remote source.

Consumer wrappers can import `runOperation(command, options)`, `resolveContext`,
or `runCLI(argv, {env, stdout, stderr})` from `@tanaab/codex-tools`.
`runCLI` returns an exit code without setting process state; `runOperation` returns
the same normalized result used by JSON output. Options include `repoRoot`,
`cachePathOverride`, `codexHome`, `marketplace`, `managedPaths`, `excludeNames`,
`missingTarget`, `absentCheck`, and `dryRun`. Low-level tree functions are also
exported; wrappers should use `runOperation` to retain installation checks.
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
