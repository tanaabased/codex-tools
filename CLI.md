# CLI

Use this guide for the complete `codex-tools` command contract. Start with the
[README](./README.md) for installation and a first dry run; use the generated
[API reference](./API.md) when calling the package from JavaScript or TypeScript.

## Invocation and prerequisites

The installed executable requires Node `^24.15.0 || >=26.0.0`. A source checkout uses the Bun
version pinned by `.bun-version`:

```sh
codex-tools --help
bun run codex-tools --help
```

| Operation                         | Additional prerequisites                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `install <path>`                  | Codex `0.154.x`; source `.codex-plugin/plugin.json`                      |
| `install npm:<selector>`          | Codex `0.154.x`; npm on `PATH`; registry credentials in npm config       |
| `refresh <path>`                  | Existing enabled local installation and matching local marketplace       |
| `refresh npm:<package>`           | Existing enabled npm installation; npm on `PATH`; pinned package release |
| `status`, `doctor`, `cache check` | Source identity and readable selected state; no Codex process is started |
| `cache sync`                      | One unambiguous installed cache, or an explicit opted-in raw target      |

Install and refresh are verified against Codex 0.154.0. Unsupported Codex
versions fail before marketplace edits. Cache commands inspect files and configuration directly;
they do not invoke Codex.

## Install

### Local source

`install [plugin-path]` defaults to the current directory. It validates the manifest identity and
declared skill, app, and MCP resource paths, then delegates acquisition to `codex plugin add`.
These are installation prerequisites, not a behavioral certification of the plugin.

```sh
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin
```

The default personal marketplace is `~/.agents/plugins/marketplace.json`. Existing marketplace
metadata, policies, entry order, unrelated entries, and matching source links are preserved.
Conflicting files, dangling links, names, sources, or policies are rejected rather than replaced.

Use an existing local marketplace by name, or register an explicit local catalog root during
installation:

```sh
codex-tools install /path/to/plugin \
  --marketplace team \
  --marketplace-path /path/to/market/.agents/plugins/marketplace.json
```

`--codex-home` selects Codex configuration and cache state; the personal marketplace still belongs
to `HOME`.

### npm package

Prefix the package selector with `npm:`. A missing selector means `latest`; exact versions, tags,
and ranges are accepted for installation. Quote shell-sensitive ranges.

```sh
codex-tools install npm:@scope/plugin@1.2.3
codex-tools install 'npm:@scope/plugin@^1.2.0' --dry-run --json
codex-tools install npm:plugin@stable --marketplace team
```

After installing the Codex Tools CLI globally, the same package provides its setup and maintenance
skills as an npm-backed Codex plugin:

```sh
codex-tools install npm:@tanaab/codex-tools --dry-run --json
codex-tools install npm:@tanaab/codex-tools
```

Open a fresh Codex task after installation so the packaged skills are discovered.

npm aliases, Git or URL dependencies, filesystem acquisition, empty selectors, and malformed
selectors are rejected. Registry URLs must use HTTPS and contain no embedded credentials, query,
or fragment. Keep credentials in npm user configuration or npm environment settings; project-only
`.npmrc` authentication is insufficient because Codex performs acquisition outside the project.

Codex Tools resolves an exact release, asks Codex to acquire it, validates the acquired plugin
identity and declared resources, then pins the package release in marketplace provenance. Package
lifecycle scripts remain disabled by native Codex. Raw npm and Codex npm failure output is withheld
because it can echo credentials.

See the executable
[installation scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/install).

## Refresh

### Local source

`refresh [plugin-path]` requires an existing matching, enabled local installation. It does not
create marketplaces or repair ambiguous mappings. The command atomically rewrites the source
manifest version with a `+codex.<UTC timestamp>` suffix, asks Codex to reinstall it, and compares
the installed payload with a stable source snapshot.

```sh
codex-tools refresh /path/to/plugin --dry-run --json
codex-tools refresh /path/to/plugin
```

Review and commit the manifest edit in the plugin repository. If refresh fails after applying the
edit, the cachebuster remains; completed marketplace or native effects are not rolled back.
Payload symlinks are rejected because native Codex does not copy them completely.

### npm package

An npm refresh retains the exact installed package release. It does not resolve a moved tag, edit a
cachebuster, or upgrade the dependency. An explicit refresh version must equal the pin.

```sh
codex-tools refresh npm:@scope/plugin
```

See the executable
[refresh scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/refresh).

## Inspect status

`status` and its `doctor` alias are read-only. They report source identity, the selected Codex home,
marketplace and cache candidates, compatibility, registration, enabled state when observable, and
payload drift.

```sh
codex-tools status --repo-root /path/to/plugin --json
codex-tools doctor --repo-root /path/to/plugin
```

`installed` means a compatible cache entry was found in the supported layout. It does not prove
authentication, activation in an existing task, or runtime behavior. See the executable
[status scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/status).

## Reconcile cache content

`cache check` reports drift without writing. `cache sync` copies the selected managed payload,
preserves unmanaged and excluded content, verifies convergence, and refuses ambiguous targets.

```sh
codex-tools cache check --repo-root /path/to/plugin --marketplace personal
codex-tools cache sync --repo-root /path/to/plugin --dry-run
codex-tools cache sync --repo-root /path/to/plugin
```

The source `package.json#codexTools` object can select cache ownership and absence behavior:

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

Omit `managedPaths`, or set it to `null`, for whole-tree selection. `.git`, `node_modules`, and
`.DS_Store` are always excluded. `excludeNames` adds consumer-owned basename exclusions.

Raw-target creation is an explicit compatibility mode, not installation:

```sh
codex-tools cache sync \
  --repo-root /path/to/plugin \
  --cache-path /tmp/payload \
  --missing-target create \
  --dry-run
```

Remove `--dry-run` to create or synchronize the directory. The result is
`synchronized_directory`, never `installed`. See the executable
[cache scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/cache) and
[default-selection scenario](https://github.com/tanaabased/codex-tools/tree/main/examples/defaults).

## Options

| Option                      | Meaning                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `--repo-root <path>`        | Local source; defaults to the current directory                  |
| `--cache-path <path>`       | Explicit installed cache or raw target                           |
| `--codex-home <path>`       | Codex home; defaults to `CODEX_HOME` or `~/.codex`               |
| `--marketplace <name>`      | Select a marketplace or disambiguate matching caches             |
| `--marketplace-path <file>` | Local marketplace catalog for install or refresh                 |
| `--missing-target <mode>`   | `require-installed` or `create`; defaults to `require-installed` |
| `--absent-check <mode>`     | `fail` or `neutral`; defaults to `fail`                          |
| `--dry-run`                 | Plan install, refresh, or sync without writes or child processes |
| `--json`                    | Write one undecorated machine-readable value to stdout           |
| `--debug`, `--no-debug`     | Enable or disable diagnostics on stderr                          |
| `-h`, `--help`              | Display help                                                     |
| `-V`, `-v`, `--version`     | Display the package version                                      |

`--marketplace-path` is valid only for install and refresh. `--dry-run` is valid only for install,
refresh, and cache sync. Unknown or repeated flags, missing values, invalid commands, and extra
arguments fail before filesystem effects.

## Environment and precedence

| Environment variable             | Equivalent option        |
| -------------------------------- | ------------------------ |
| `CODEX_TOOLS_REPO_ROOT`          | `--repo-root`            |
| `CODEX_TOOLS_CACHE_PATH`         | `--cache-path`           |
| `CODEX_TOOLS_CODEX_HOME`         | `--codex-home`           |
| `CODEX_TOOLS_MARKETPLACE`        | `--marketplace`          |
| `CODEX_TOOLS_MARKETPLACE_PATH`   | `--marketplace-path`     |
| `CODEX_TOOLS_MISSING_TARGET`     | `--missing-target`       |
| `CODEX_TOOLS_ABSENT_CHECK`       | `--absent-check`         |
| `CODEX_TOOLS_JSON`               | `--json`                 |
| `CODEX_TOOLS_DEBUG`              | `--debug`                |
| `CODEX_TOOLS_DRY_RUN`            | `--dry-run`              |
| `TANAAB_DEBUG`, `RUNNER_DEBUG=1` | Ambient debug enablement |

Explicit options override `CODEX_TOOLS_*` values. `CODEX_TOOLS_CODEX_HOME` precedes `CODEX_HOME`;
without either, Codex Tools uses `~/.codex`. Cache selection options then override
`package.json#codexTools`, whose missing values fall back to the defaults above. Boolean environment
values accept `1`, `true`, `0`, or `false`. See the executable
[input and precedence scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/inputs).

## Output, dry runs, and exit codes

Text output is intended for people. With `--json`, stdout contains exactly one undecorated JSON
value; diagnostics and debug remain on stderr.

Dry-run install, refresh, and cache sync perform no writes and start no child processes. A plan can
therefore contain unresolved npm or native checks rather than pretending they happened.

| Exit | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| `0`  | Current, synchronized, valid plan, help/version, or explicitly neutral absence        |
| `1`  | Drift, unavailable/incompatible installation, ambiguous target, or failed convergence |
| `2`  | Invalid arguments, source/configuration errors, or filesystem failure                 |

A failing native child retains its own exit code. Partial installation or refresh failures report
completed and remaining operations; earlier effects are not automatically rolled back.
