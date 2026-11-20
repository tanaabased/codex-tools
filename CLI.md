# CLI

Use this guide to run Codex Tools from a terminal or npm script. See the [README](./README.md)
for package installation and [advanced usage](./ADVANCED.md) for marketplace and cache behavior.

## Invocation

```sh
codex-tools <command> [source] [options]
npm exec --offline -- codex-tools <command> [source] [options]
```

| Command                                       | Purpose                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `install [path\|npm:<selector>]`              | Install a local or published plugin; omitted path uses the current directory.                               |
| `refresh [path\|npm:<package>]`               | Reinstall an enabled plugin; local refresh edits its manifest version, npm refresh retains its release pin. |
| `status`                                      | Inspect identity, installation state, and payload drift without writing.                                    |
| `doctor`                                      | Alias for `status`.                                                                                         |
| `cache check`                                 | Report selected cache drift without writing.                                                                |
| `cache sync`                                  | Reconcile managed content while preserving unmanaged and excluded entries.                                  |
| `cloud package [config]`                      | Prepare selected skills in place in the release checkout.                                                   |
| `cloud verify [config] --package <directory>` | Verify the selected skills in the extracted release.                                                        |

Local plugins need `.codex-plugin/plugin.json`. npm selectors accept exact versions, tags, or
quoted ranges; omitting the version selects `latest`. npm acquisition requires npm on `PATH`.
Read-only commands do not start Codex. See
[refresh and recovery](./ADVANCED.md#refresh-and-recovery) for partial effects.

## Cloud skills

In a fresh Git checkout, prepare the selected skills in place, then pack the release. Extract the
tarball and check the files that will ship, using the same checkout for source expectations.

```sh
codex-tools cloud package
tarball=$(npm pack --silent)
mkdir -p unpacked
tar -xzf "$tarball" -C unpacked
codex-tools cloud verify --package ./unpacked/package
```

Both commands take one optional config path. From inside a skill, they look for the closest
`build.config.js` beside a tracked `SKILL.md` in the current directory or its ancestors.
Otherwise they use the nearest `cloud.config.js` up to the Git root. An explicit JavaScript
config may have a custom name. A default export with `skills` selects from the repository.
A build config belongs beside the skill’s `SKILL.md`.

```js
// cloud.config.js
export default { skills: 'skills/*/SKILL.md' };
```

```js
// skills/writer/build.config.js
export default { entrypoints: 'scripts/*.js', copy: ['references/**', '!references/private/**'] };
```

Selectors take a glob or an array of globs over tracked paths, including dotfiles. Exclusions win. Skill discovery and
copies use repository-relative paths. Entrypoints use skill-relative paths. Packaging skips skills
without a build config. An empty config (`export default {}`) materializes tracked relative links.
Set `symlinks: false` for a skill that ships without symlinks. Copies fill missing paths after
link materialization.

Put Bun on `PATH` to bundle commands. Each command keeps its path; its length, SHA-256 and emitted
assets appear in the skill’s `runtime-files.json`. The default `guidance: 'auto'` inserts execution
instructions at `<!-- packaged-execution -->` when there are commands. Use `'on'` to require
both a command and exactly one marker, or `'off'` to remove the marker. Start again from a fresh
checkout if packaging fails after making changes.

Verification is read-only. It checks all discovered skills, including plain prose, against the
extracted files. Reader links can target Markdown (`.md`), JavaScript (`.js`), JSON (`.json`),
and plain text (`.txt`) inside the skill. Markdown links are followed recursively. Markdown under `templates/`
may use an uppercase URL placeholder such as `DOCS_URL`.
For a raw starter such as a workflow YAML, link an annotated Markdown example that names the
intended output file. Raw files can still be command assets.

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

| Field       | Value                                            |
| ----------- | ------------------------------------------------ |
| Alias       | `-h`                                             |
| Values      | value-free flag                                  |
| Description | Shows usage, options, and environment variables. |

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
