# Contributing to Codex Tools

Use the [README](./README.md) for installation and the [CLI reference](./CLI.md) for command behavior.

## Setup

Use Bun from `.bun-version` for source work and Node from `.node-version` for built and packed
consumers. Install dependencies without lifecycle scripts:

```sh
git clone https://github.com/tanaabased/codex-tools.git
cd codex-tools
bun install --frozen-lockfile --ignore-scripts
bun run check:toolchain
bun run codex-tools --help
```

## Develop and validate

| Command                | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `bun run lint`         | ESLint and Prettier                                     |
| `bun run format:write` | Apply formatting                                        |
| `bun run typecheck`    | Check TypeScript source                                 |
| `bun run test`         | Run runtime, development, and example-helper unit tests |
| `bun run docs:check`   | Generated API drift, local links, and images            |
| `bun run docs:api`     | Generate API.md from public TypeScript docblocks        |

Run lint, typecheck, and tests after source changes. Run `docs:check` after documentation or public
API changes. Edit public docblocks, including `@example`, rather than the generated API reference.

## Artifacts and integration

Build the CLI and library artifacts, then prepare a local package:

```sh
bun run build
mkdir -p .temp/package
npm pack --ignore-scripts --pack-destination=.temp/package
```

The build emits the Node CLI, ESM/CommonJS bundles, and matching declarations. Example Tests owns
CLI scenarios; Release Tests owns package preparation, plugin validation, and publication dry runs.
The commands above publish nothing.

## Install a local release candidate

After preparing the package above, extract its tarball into an empty directory:

```sh
candidate="$(mktemp -d "$PWD/.temp/codex-tools.XXXXXX")"
version="$(bun -p 'require("./package.json").version')"
tar -xzf ".temp/package/tanaab-codex-tools-$version.tgz" -C "$candidate" --strip-components=1
```

For Codex, let the extracted CLI install its own plugin:

```sh
node "$candidate/dist/codex-tools" install "$candidate" --dry-run --json
node "$candidate/dist/codex-tools" install "$candidate"
```

For OpenClaw, use `openclaw plugins install "$candidate"`. Keep the extracted directory while
using this local installation, and start a fresh task or session to discover its skills.
See [plugin usage](./PLUGINS.md) for both hosts. Local installations do not follow npm updates.

## Leia scenarios

PR CI runs every Leia example on Ubuntu and macOS against the built CLI with
`bun run leia <scenario> --shell bash`. Each example owns its sample plugins, helpers, and fake
commands. The `native` and `native-npm` scenarios use real Codex,
including packed-plugin skill discovery and a disposable HTTPS registry.
Local Leia execution requires an explicit request. Read
[examples/AGENTS.md](https://github.com/tanaabased/codex-tools/blob/main/examples/AGENTS.md)
before editing scenarios.

## Releases

Use Canon's [Release Author](https://github.com/tanaabased/canon/tree/main/skills/release-author)
skill for releases. Keep upcoming changes in [CHANGELOG.md](./CHANGELOG.md).
