# Codex Tools

<p align="center">
  <img src="./assets/codex-tools.png" alt="Codex Tools" width="180" />
</p>

<p align="center">
  <a href="https://github.com/tanaabased/codex-tools/releases"><img src="https://img.shields.io/github/v/release/tanaabased/codex-tools?include_prereleases&amp;sort=semver" alt="Latest release, including prereleases" /></a>
  <a href="https://github.com/tanaabased/codex-tools/actions/workflows/pr-linter.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/codex-tools/pr-linter.yml?event=pull_request&amp;label=Lint" alt="Lint" /></a>
  <a href="https://github.com/tanaabased/codex-tools/actions/workflows/pr-unit-tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/codex-tools/pr-unit-tests.yml?event=pull_request&amp;label=Unit%20Tests" alt="Unit Tests" /></a>
  <a href="https://github.com/tanaabased/codex-tools/actions/workflows/pr-examples-tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/codex-tools/pr-examples-tests.yml?event=pull_request&amp;label=Example%20Tests" alt="Example Tests" /></a>
  <a href="https://github.com/tanaabased/codex-tools/actions/workflows/pr-release-tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/codex-tools/pr-release-tests.yml?event=pull_request&amp;label=Release%20Tests" alt="Release Tests" /></a>
</p>

Develop Codex plugins and install them with less setup. Codex Tools handles marketplace registration,
installation, source refresh, and cache synchronization through a CLI, typed JavaScript API,
and agent skills.

## Overview

- **Install local plugins:** set up a personal marketplace automatically while preserving existing entries.
- **Install from npm:** resolve a package version, install its plugin, and retain the exact release pin.
- **Refresh source plugins:** update the development version and reinstall changes through Codex.
- **Sync installed caches:** copy changes from a source repository into its selected live plugin cache while preserving unmanaged files.
- **Inspect and preview:** report installation state and drift with `status`/`doctor`, or preview changes with a dry run.

## Install

Requires Node `^24.15.0 || >=26.0.0`. On the first install or refresh, Codex Tools downloads its
exact supported Codex CLI for macOS or Linux on arm64 or x64. The verified executable is cached
under `$XDG_CACHE_HOME/codex-tools` or `$HOME/.cache/codex-tools`; no host `codex` command is
required.

```sh
npm install --global @tanaab/codex-tools
codex-tools --help
```

For library use, install locally with `npm install @tanaab/codex-tools`.
For unpublished builds, see [local candidate installation](./CONTRIBUTING.md#install-a-local-release-candidate).

## Usage

### CLI

```sh
# preview an installation, then apply it.
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin

# install a published plugin package.
codex-tools install npm:@scope/plugin@1.2.3

# inspect the installation and refresh its local source.
codex-tools status --repo-root /path/to/plugin --json
codex-tools refresh /path/to/plugin

# report cache drift, then preview synchronization.
codex-tools cache check --repo-root /path/to/plugin
codex-tools cache sync --repo-root /path/to/plugin --dry-run
```

Dry runs write nothing, start no child processes, and do not provision Codex. Read-only status and
cache checks also remain offline. Commands refuse ambiguous targets and preserve unrelated state.
Local refresh edits the source manifest version; review and commit that edit.

See the [CLI reference](./CLI.md) for all commands, options, environment variables, and exit codes.

### Library

```ts
import { runOperation, type CodexToolsOptions } from '@tanaab/codex-tools';

const options: CodexToolsOptions = {
  repoRoot: '/path/to/plugin',
  codexHome: '/path/to/codex-home',
};
const result = await runOperation('status', options);

if (!result.ok) console.error(result.issue);
```

The package supports ESM imports and CommonJS `require`. Import from `@tanaab/codex-tools`;
internal paths are unsupported. The generated [API reference](./API.md) covers public functions,
types, results, and side effects.

### Use with an agent

Install the Codex Tools plugin into Codex or OpenClaw, then ask:

- **Setup:** “Use `$tanaab-codex-tools-setup` to preview and install the plugin at `/path/to/plugin`.”
- **Maintenance:** “Use `$tanaab-codex-tools-maintenance` to inspect this plugin and explain any cache drift.”

See [plugin installation](./PLUGINS.md) for host requirements and installation commands.

## Advanced usage

See [advanced usage](./ADVANCED.md) for marketplace and cache ownership, npm pinning, and recovery.

## Development

See [CONTRIBUTING](./CONTRIBUTING.md) for source setup, generation, and validation.

## License

[MIT](./LICENSE). See [NOTICE](./NOTICE) for attribution.
