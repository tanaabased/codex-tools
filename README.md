<h1 align="center">Codex Tools</h1>

<p align="center">
  <img src="./assets/codex-tools.png" alt="Codex Tools" width="180" />
</p>

<p align="center">
  Easily install and refresh Codex plugins, sync installed caches from source, and package self-contained skills for Codex Cloud. Available as a CLI, a JavaScript library, or agent skills.
</p>

<p align="center">
  <a href="https://github.com/tanaabased/codex-tools/releases/latest"><img src="https://img.shields.io/github/v/release/tanaabased/codex-tools?label=STABLE&amp;color=blue" alt="Latest stable release" /></a>
  <a href="https://github.com/tanaabased/codex-tools/releases"><img src="https://img.shields.io/github/v/release/tanaabased/codex-tools?include_prereleases&amp;sort=date&amp;label=EDGE&amp;color=blue" alt="Latest release including prereleases" /></a>
  <a href="https://github.com/tanaabased/codex-tools/actions/workflows/pr-examples-tests.yml?query=event%3Apull_request"><img src="https://img.shields.io/github/actions/workflow/status/tanaabased/codex-tools/pr-examples-tests.yml?event=pull_request&amp;label=LEIA" alt="Leia scenario test status" /></a>
</p>

<p align="center">
  <a href="#cli-installation"><img src="https://img.shields.io/badge/NPM-CLI-6f42c1" alt="Use the npm CLI" /></a>
  <a href="#library-installation"><img src="https://img.shields.io/badge/NPM-library-6f42c1" alt="Use the npm library" /></a>
  <a href="./PLUGINS.md#codex"><img src="https://img.shields.io/badge/CODEX-plugin-6f42c1" alt="Install the Codex plugin" /></a>
  <a href="./PLUGINS.md#openclaw"><img src="https://img.shields.io/badge/OPENCLAW-plugin-6f42c1" alt="Install the OpenClaw plugin" /></a>
</p>

## Overview

- **Install local plugins:** set up a personal marketplace automatically while preserving existing entries.
- **Install from npm:** resolve a package version, install its plugin, and retain the exact release pin.
- **Refresh source plugins:** update the development version and reinstall changes through Codex.
- **Sync installed caches:** copy changes from a source repository into its selected live plugin cache while preserving unmanaged files.
- **Inspect and preview:** report installation state and drift with `status`/`doctor`, or preview changes with a dry run.
- **Package skills for Codex Cloud:** prepare skills in a release checkout and verify the extracted npm package. See [`cloud package`](./CLI.md#codex-tools-cloud-package).

## Install

See [`package.json`](./package.json) for the Node engine range and the Bun package manager version.
The tested versions are pinned in [`.node-version`](./.node-version) and [`.bun-version`](./.bun-version).
Native plugin installation and refresh support macOS and Linux on arm64 or x64.

### CLI installation

```sh
# install globally with npm.
npm install --global @tanaab/codex-tools

# or install globally with bun.
bun add --global @tanaab/codex-tools

# check the CLI after either install.
codex-tools --help
```

### Library installation

```sh
# add to your project with npm.
npm install @tanaab/codex-tools

# or add to your project with bun.
bun add @tanaab/codex-tools
```

### Agent installation

```sh
# install in codex.
npx @tanaab/codex-tools install npm:@tanaab/codex-tools

# or install in openclaw.
openclaw plugins install npm:@tanaab/codex-tools
```

## Usage

- [CLI](./CLI.md)
- [Library](./API.md)
- [Agent](./PLUGINS.md)

## Advanced usage

See [advanced usage](./ADVANCED.md) for marketplace and cache ownership.

## Development

See [CONTRIBUTING](./CONTRIBUTING.md) to work on Codex Tools.

## Issues, Questions and Support

[Search GitHub Issues](https://github.com/tanaabased/codex-tools/issues) for existing reports and answers.
If you don’t find what you need, [open an issue](https://github.com/tanaabased/codex-tools/issues/new/choose).

## Changelog

See the [changelog](./CHANGELOG.md) for what changed and [GitHub Releases](https://github.com/tanaabased/codex-tools/releases) for published versions.

## Contributors

<a href="https://github.com/tanaabased/codex-tools/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=tanaabased/codex-tools" alt="Codex Tools contributors" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## License

[MIT](./LICENSE). See [NOTICE](./NOTICE) for attribution.
