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

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `bun run lint`         | ESLint and Prettier                                  |
| `bun run format:write` | Apply formatting                                     |
| `bun run typecheck`    | Check TypeScript source                              |
| `bun run test`         | Run application and development-tool unit tests      |
| `bun run test:app`     | Runtime policy, parsing, and safety tests in `test/` |
| `bun run test:dev`     | Maintainer-helper tests in `dev/test/`               |
| `bun run docs:check`   | Generated API drift, local links, and images         |
| `bun run docs:api`     | Generate API.md from public TypeScript docblocks     |

Run lint, typecheck, and tests after source changes. Run `docs:check` after documentation or public
API changes. Edit public docblocks, including `@example`, rather than the generated API reference.

## Artifacts and integration

Build once, then check the prepared package:

```sh
bun run build
bun run check:package --pack-destination=.temp/package
```

The build emits the Node CLI, ESM/CommonJS bundles, and matching declarations. The package check
packs and exercises the exact payload in a disposable Node consumer, including both module
formats, type exports, documentation examples, skills, and assets. Run it for changes to build,
packaging, shipped documentation, or the artifact contract. Nothing is published.
Pass `--tarball=/path/to/package.tgz` to check an existing tarball without repacking it.

`bun run test:native` checks installation, refresh, and preservation through real Codex;
`bun run test:native:npm` checks acquisition through a disposable HTTPS registry. Both build first.
Run these when changing native compatibility or the probes themselves.

## Install a local release candidate

After building and checking the package above, extract its tarball into an empty directory:

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

PR CI runs Leia 2 against `dist/codex-tools` through `bun run test:leia <scenario> --shell bash`.
The six groups cover defaults, inputs, install, refresh, status, and cache behavior. Fixtures live
beside their scenarios, with shared fake child commands in `examples/fixtures/bin`.
Read [examples/AGENTS.md](https://github.com/tanaabased/codex-tools/blob/main/examples/AGENTS.md)
before editing them. Local Leia execution requires an explicit request.

The fake commands verify orchestration. The Native Codex Verification workflow separately installs
the packed plugin, checks fresh-session skill discovery, and invokes its cached runtime on Linux
and macOS. PR CI also validates the plugin with `tanaabased/actions/validate-codex-plugin@v1`.

## Releases

Use Canon's [Release Author](https://github.com/tanaabased/canon/tree/main/skills/release-author)
skill for releases. Keep upcoming changes in [CHANGELOG.md](./CHANGELOG.md).
