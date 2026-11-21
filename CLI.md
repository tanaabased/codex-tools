# CLI

<a name="invocation"></a>

## Usage

```sh
# run an installed CLI.
codex-tools <command> [arguments] [options]

# run the npm package with npx.
npx @tanaab/codex-tools <command> [arguments] [options]

# run the npm package with bunx.
bunx --package @tanaab/codex-tools codex-tools <command> [arguments] [options]
```

See the [README](./README.md#install) to install the CLI and [Advanced usage](./ADVANCED.md) for
marketplace setup and cache configuration.

| Command                                       | Description                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| [`cache check`](#codex-tools-cache-check)     | Compare source and installed cache files.             |
| [`cache sync`](#codex-tools-cache-sync)       | Bring selected cache files into sync with the source. |
| [`cloud package`](#codex-tools-cloud-package) | Prepare skills for Codex Cloud in a release checkout. |
| [`cloud verify`](#codex-tools-cloud-verify)   | Check the skills in an extracted release.             |
| [`doctor`](#codex-tools-doctor)               | Run the same inspection as `status`.                  |
| [`install`](#codex-tools-install)             | Install a local or npm-backed plugin.                 |
| [`refresh`](#codex-tools-refresh)             | Reinstall an enabled plugin.                          |
| [`status`](#codex-tools-status)               | Inspect installation state and cache drift.           |

### Global options

These options apply to every command. Pass options that take a value as `--name value` or
`--name=value`.

| Option                  | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `-h`, `--help`          | Show CLI help.                                                    |
| `-V`, `-v`, `--version` | Show the CLI version.                                             |
| `--json`, `--no-json`   | Write JSON to stdout. Diagnostics stay on stderr.                 |
| `--debug`               | Show diagnostics on stderr. Use `--debug=false` to turn them off. |

### `codex-tools cache check`

Compare managed files in the source and selected cache without changing either one. See
[cache ownership](./ADVANCED.md#cache-ownership) to select which files are compared.

#### Options

| Option                    | Default                      | Description                                                          |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `--repo-root <path>`      | Current directory            | Select the source plugin.                                            |
| `--cache-path <path>`     | Discover installed cache     | Select a specific cache directory.                                   |
| `--codex-home <path>`     | `~/.codex` unless configured | Select the Codex home to check.                                      |
| `--marketplace <name>`    | Discover marketplace         | Disambiguate matching installations.                                 |
| `--missing-target <mode>` | `require-installed`          | Use `create` with `--cache-path` to check an explicit raw directory. |
| `--absent-check <mode>`   | `fail`                       | Use `neutral` if an absent installation is acceptable.               |

#### Usage

```text
codex-tools cache check [options]
```

```sh
codex-tools cache check --repo-root /path/to/plugin --json
```

### `codex-tools cache sync`

Copy new and changed managed files into the selected cache and remove extra managed files.
Unmanaged and excluded files are preserved. To create or update a raw directory instead,
choose it explicitly with `--cache-path` and `--missing-target create`.

#### Options

| Option                    | Default                      | Description                                             |
| ------------------------- | ---------------------------- | ------------------------------------------------------- |
| `--repo-root <path>`      | Current directory            | Select the source plugin.                               |
| `--cache-path <path>`     | Discover installed cache     | Select a cache or an explicit raw target.               |
| `--codex-home <path>`     | `~/.codex` unless configured | Select the Codex home to sync.                          |
| `--marketplace <name>`    | Discover marketplace         | Disambiguate matching installations.                    |
| `--missing-target <mode>` | `require-installed`          | Use `create` with `--cache-path` to allow a raw target. |
| `--dry-run`               | Off                          | Show the planned file changes without applying them.    |

#### Usage

```text
codex-tools cache sync [options]
```

```sh
# review changes, then sync the installed cache.
codex-tools cache sync --repo-root /path/to/plugin --dry-run
codex-tools cache sync --repo-root /path/to/plugin
```

### `codex-tools cloud package`

Prepare selected skills in place in a fresh Git checkout. This command materializes tracked
relative symlinks, copies shared files, and bundles configured commands. Command bundling needs
Bun on `PATH`. If packaging fails after changing files, start again from a fresh checkout.

#### Options

| Option or argument | Default                                               | Description                                                                                                                                         |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<config>`         | Discover from the current directory and its ancestors | Select a JavaScript config. Discovery prefers `build.config.js` beside a tracked `SKILL.md`, then the nearest `cloud.config.js` up to the Git root. |

#### Usage

```text
codex-tools cloud package [<config>] [options]
```

```sh
# prepare every skill selected by cloud.config.js.
codex-tools cloud package

# prepare one skill.
codex-tools cloud package skills/writer/build.config.js
```

Use `cloud.config.js` to select tracked skills from the repository. Add `build.config.js` next
to each `SKILL.md` you want to prepare.

```js
// cloud.config.js
export default { skills: 'skills/*/SKILL.md' };
```

```js
// skills/writer/build.config.js
export default { entrypoints: 'scripts/*.js', copy: ['references/**', '!references/private/**'] };
```

| Config key    | Description                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills`      | Repository-relative globs for tracked `SKILL.md` files.                                                                                                                          |
| `entrypoints` | Skill-relative globs for `.js` or `.mjs` commands. Imports can include TypeScript or CommonJS.                                                                                   |
| `copy`        | Repository-relative globs for shared files. Copies fill missing paths and preserve skill-local files.                                                                            |
| `symlinks`    | Defaults to `true`. Use `false` to reject symlinks in the skill.                                                                                                                 |
| `guidance`    | Defaults to `'auto'`. Add `<!-- packaged-execution -->` to insert command instructions. Use `'on'` to require a command and exactly one marker, or `'off'` to remove the marker. |

Globs select tracked files, including dotfiles. `!` exclusions win. An empty build config
(`export default {}`) materializes tracked relative symlinks without bundling commands.

### `codex-tools cloud verify`

Check the selected skills against the source checkout after extracting the release. Verification
is read-only and also checks skills without commands. Run it from the source checkout or pass that
checkout’s config path.

#### Options

| Option or argument      | Default                                                         | Description                                           |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| `<config>`              | Same discovery as [`cloud package`](#codex-tools-cloud-package) | Select the source config used to prepare the release. |
| `--package <directory>` | Required                                                        | Point to the extracted package directory.             |

#### Usage

```text
codex-tools cloud verify [<config>] --package <directory> [options]
```

```sh
# after cloud package, pack and verify from the same source checkout.
tarball=$(npm pack --silent)
mkdir -p unpacked
tar -xzf "$tarball" -C unpacked
codex-tools cloud verify --package ./unpacked/package
```

Link to concrete files inside each skill, including from linked Markdown. Use one of these
case-insensitive extensions for links and bundled command resources. `.c`, `.css`, `.csv`,
`.h`, `.htm`, `.html`, `.js`, `.json`, `.md`, `.mjs`, `.py`, `.rst`, `.sh`, `.svg`, `.tsv`,
`.txt`, and `.xml` are supported. For a YAML starter, link to a Markdown example such as
`workflow.yml.md` that names the expected output file. Inline unsupported command resources
into the bundle.

In Markdown under `templates/`, a placeholder such as `{{ docs_url }}` or `DOCS_URL` can
replace the entire link destination, including in a reference definition.

### `codex-tools doctor`

Alias for [`status`](#codex-tools-status), with the same options and read-only behavior.

#### Usage

```text
codex-tools doctor [options]
```

```sh
codex-tools doctor --repo-root /path/to/plugin --marketplace personal
```

### `codex-tools install`

Install from a directory containing `.codex-plugin/plugin.json` or from a published npm package.
npm selectors require npm on `PATH` and accept exact versions, tags, and quoted ranges. Omit the
version to use `latest`. To change the installed npm version, run `install` with the new selector.

For a private registry, use an HTTPS URL without embedded credentials, a query, or a fragment.
Configure access in your user `.npmrc` or npm environment so credentials are available outside the
project directory.

#### Options

| Option or argument           | Default                      | Description                                                      |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `<path>` or `npm:<selector>` | Current directory            | Choose a local source or npm package.                            |
| `--repo-root <path>`         | Current directory            | Choose a local source when you omit the positional argument.     |
| `--codex-home <path>`        | `~/.codex` unless configured | Select Codex configuration and cache state.                      |
| `--marketplace <name>`       | Selected catalog name        | Choose a marketplace. A new default catalog is named `personal`. |
| `--marketplace-path <file>`  | Selected catalog             | Choose a local `.agents/plugins/marketplace.json` file.          |
| `--dry-run`                  | Off                          | Preview the installation without writes or child processes.      |

#### Usage

```text
codex-tools install [<path> | npm:<selector>] [options]
```

```sh
# preview a local install, then apply it.
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin

# install a specific npm release.
codex-tools install npm:@scope/plugin@1.2.3
```

### `codex-tools refresh`

Reinstall an enabled plugin. A local refresh updates the source manifest version and requires a
payload with regular files in place of symlinks. An npm refresh reinstalls the pinned release.

If refresh stops partway through, check the completed and remaining steps in `--json` output.
The manifest edit and completed steps can remain in effect. For a local plugin, use
[`status`](#codex-tools-status) to inspect the installation before retrying.

#### Options

| Option or argument          | Default                      | Description                                                  |
| --------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `<path>` or `npm:<package>` | Current directory            | Choose the existing local source or pinned npm package.      |
| `--repo-root <path>`        | Current directory            | Choose a local source when you omit the positional argument. |
| `--codex-home <path>`       | `~/.codex` unless configured | Select Codex configuration and cache state.                  |
| `--marketplace <name>`      | Selected catalog name        | Choose the marketplace where the plugin is installed.        |
| `--marketplace-path <file>` | Selected catalog             | Select the local catalog used for the installation.          |
| `--dry-run`                 | Off                          | Preview the refresh without writes or child processes.       |

#### Usage

```text
codex-tools refresh [<path> | npm:<package>] [options]
```

```sh
# reinstall a local plugin after changing its files.
codex-tools refresh /path/to/plugin

# reinstall the recorded npm release.
codex-tools refresh npm:@scope/plugin
```

### `codex-tools status`

Report the selected plugin’s installation, registration, enablement, and cache drift without
writing files or starting Codex.

#### Options

| Option                    | Default                      | Description                                                                                          |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--repo-root <path>`      | Current directory            | Select the source plugin.                                                                            |
| `--cache-path <path>`     | Discover installed cache     | Select a specific cache directory.                                                                   |
| `--codex-home <path>`     | `~/.codex` unless configured | Select Codex configuration and cache state.                                                          |
| `--marketplace <name>`    | Discover marketplace         | Disambiguate matching installations.                                                                 |
| `--missing-target <mode>` | `require-installed`          | Use `create` with `--cache-path` to inspect a raw directory. The check reads it without creating it. |
| `--absent-check <mode>`   | `fail`                       | Use `neutral` if an absent installation is acceptable.                                               |

#### Usage

```text
codex-tools status [options]
```

```sh
codex-tools status --repo-root /path/to/plugin --json
```
