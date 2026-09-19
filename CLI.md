# CLI

Use this guide to run Codex Tools from a terminal or npm script. See the [README](./README.md)
for package installation and [advanced usage](./ADVANCED.md) for marketplace and cache behavior.

## Invocation

```sh
codex-tools <command> [source] [options]
npm exec --offline -- codex-tools <command> [source] [options]
```

| Command                          | Purpose                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `install [path\|npm:<selector>]` | Install a local or published plugin; omitted path uses the current directory.                               |
| `refresh [path\|npm:<package>]`  | Reinstall an enabled plugin; local refresh edits its manifest version, npm refresh retains its release pin. |
| `status`                         | Inspect identity, installation state, and payload drift without writing.                                    |
| `doctor`                         | Alias for `status`.                                                                                         |
| `cache check`                    | Report selected cache drift without writing.                                                                |
| `cache sync`                     | Reconcile managed content while preserving unmanaged and excluded entries.                                  |

Local plugins need `.codex-plugin/plugin.json`. npm selectors accept exact versions, tags, or
quoted ranges; omitting the version selects `latest`. Install and refresh require Codex `0.154.x`
(verified with `0.154.0`), and npm acquisition also requires npm on `PATH`. Read-only commands do
not start Codex. See [refresh and recovery](./ADVANCED.md#refresh-and-recovery) for partial effects.

## Options

Flags override `CODEX_TOOLS_*` environment defaults, then repository `package.json#codexTools`
settings where applicable. Use `--name value` or `--name=value`. Switches normally take no value.
Unknown or repeated flags, extra arguments, and invalid values fail before filesystem effects.
A positional install/refresh source replaces the environment source; combining it with an explicit
`--repo-root` is an error.

### `--repo-root`

| Field       | Value                      |
| ----------- | -------------------------- |
| Environment | `CODEX_TOOLS_REPO_ROOT`    |
| Default     | current directory          |
| Values      | local path                 |
| Description | Selects the plugin source. |

### `--cache-path`

| Field       | Value                                              |
| ----------- | -------------------------------------------------- |
| Environment | `CODEX_TOOLS_CACHE_PATH`                           |
| Default     | discovered installed cache                         |
| Values      | local path                                         |
| Description | Selects an installed cache or explicit raw target. |

### `--codex-home`

| Field       | Value                                        |
| ----------- | -------------------------------------------- |
| Environment | `CODEX_TOOLS_CODEX_HOME`                     |
| Default     | `CODEX_HOME` or `~/.codex`                   |
| Values      | local path                                   |
| Description | Selects Codex configuration and cache state. |

### `--marketplace`

| Field       | Value                                                           |
| ----------- | --------------------------------------------------------------- |
| Environment | `CODEX_TOOLS_MARKETPLACE`                                       |
| Default     | discovered marketplace; `personal` for a new local installation |
| Values      | marketplace name                                                |
| Description | Selects a marketplace or disambiguates matching caches.         |

### `--marketplace-path`

| Field       | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| Environment | `CODEX_TOOLS_MARKETPLACE_PATH`                                   |
| Default     | selected catalog                                                 |
| Values      | local catalog file                                               |
| Description | Selects a local marketplace catalog for install or refresh only. |

See [marketplace ownership](./ADVANCED.md#marketplace-ownership) for catalog locations and preservation.

### `--missing-target`

| Field       | Value                                                          |
| ----------- | -------------------------------------------------------------- |
| Environment | `CODEX_TOOLS_MISSING_TARGET`                                   |
| Default     | `require-installed`                                            |
| Values      | `require-installed`, `create`                                  |
| Description | Controls whether cache sync may create an explicit raw target. |

See [cache ownership](./ADVANCED.md#cache-ownership) for repository settings and raw-target behavior.

### `--absent-check`

| Field       | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| Environment | `CODEX_TOOLS_ABSENT_CHECK`                                    |
| Default     | `fail`                                                        |
| Values      | `fail`, `neutral`                                             |
| Description | Controls whether missing installations fail read-only checks. |

### `--dry-run`

| Field       | Value                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Environment | `CODEX_TOOLS_DRY_RUN`                                                    |
| Default     | off                                                                      |
| Values      | value-free flag                                                          |
| Description | Plans install, refresh, or cache sync without writes or child processes. |

npm and native checks may remain unresolved in the plan.

### `--json`

| Field       | Value                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Environment | `CODEX_TOOLS_JSON`                                                       |
| Default     | off                                                                      |
| Values      | value-free flag                                                          |
| Description | Writes one undecorated JSON value to stdout; diagnostics stay on stderr. |

### `--debug`

| Field       | Value                                  |
| ----------- | -------------------------------------- |
| Environment | `CODEX_TOOLS_DEBUG`                    |
| Default     | off unless `RUNNER_DEBUG=1` enables it |
| Values      | value-free flag                        |
| Description | Enables diagnostics on stderr.         |

### `--version`

| Field       | Value                                |
| ----------- | ------------------------------------ |
| Alias       | `-V`, `-v`                           |
| Values      | value-free flag                      |
| Description | Shows the installed package version. |

### `--help`

| Field       | Value                                                      |
| ----------- | ---------------------------------------------------------- |
| Alias       | `-h`                                                       |
| Values      | value-free flag                                            |
| Description | Shows usage, options, examples, and environment variables. |

## Environment defaults

Empty path and selection environment values are unset. Boolean values must be `1`, `true`, `0`,
or `false`; an empty boolean value is invalid. Set `CODEX_TOOLS_DEBUG=false` to suppress inherited
CI debug enablement.
Explicit flags override their environment values, including invalid ones. `CODEX_TOOLS_CODEX_HOME`
precedes `CODEX_HOME`; otherwise Codex Tools uses `~/.codex`. Repository settings apply only to
cache ownership and absence behavior, as described in [advanced usage](./ADVANCED.md#cache-ownership).

## Exit codes

| Exit | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| `0`  | Current, synchronized, valid plan, help/version, or explicitly neutral absence.        |
| `1`  | Drift, unavailable/incompatible installation, ambiguous target, or failed convergence. |
| `2`  | Invalid arguments, source/configuration errors, or filesystem failure.                 |

A failing native child retains its own exit code.
