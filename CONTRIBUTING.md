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
bun run check:package
```

The build emits the Node CLI, ESM/CommonJS bundles, and matching declarations. The package check
packs and exercises the exact payload in a disposable Node consumer, including both module
formats, type exports, documentation examples, skills, and assets. Run it for changes to build,
packaging, shipped documentation, or the artifact contract. Nothing is published.

`bun run test:native` checks installation, refresh, and preservation through real Codex;
`bun run test:native:npm` checks acquisition through a disposable HTTPS registry. Both build first.
Run these when changing native compatibility or the probes themselves.

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

Keep upcoming changes in [CHANGELOG.md](./CHANGELOG.md), beneath its tokenized unreleased heading.
Publishing a GitHub Release runs `.github/workflows/release.yml` from the event's fixed commit.
Use a semver prerelease tag with GitHub's prerelease flag for `edge`; stable versions go to `latest`.
The workflow rejects a mismatch. It does not move `edge` when publishing a stable version.

Preparation stamps the package, plugin, and changelog together, formats them, then builds and checks
the npm tarball. The plugin archive contains that tarball's allowed payload, including the bundled
runtime and notices; it needs no `node_modules` to run. Independent npm and plugin jobs publish the
retained artifacts without rebuilding. A separate job syncs the checked metadata to `main` and moves
the release tag. It stops if `main` has advanced. Inspect each destination before retrying a partial
release: npm versions are immutable, while plugin uploads replace the named archive.

Before the first release:

- Configure and verify npm trusted publishing for `@tanaab/codex-tools`, GitHub owner `tanaabased`,
  repository `codex-tools`, workflow `release.yml`, no environment, with direct publication allowed.
  If the package does not exist yet, arrange the initial authenticated candidate publication before
  configuring trust. See [npm's prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
- Make `TANAAB_COAXIUM_INJECTOR` available to this repository for the bot's protected-branch sync.
  The default GitHub token uploads the plugin; npm publication uses OIDC and no registry token.
- Complete issue [#5](https://github.com/tanaabased/codex-tools/issues/5)'s prepared-artifact scenario
  and macOS/Linux native verification before publishing a candidate. Consumer adoption gates stable
  publication. The current release workflow does not yet enforce those remaining gates.

PR Release Tests stamp a disposable candidate, exercise the package, and dry-run npm and plugin
archive preparation without publication credentials. These checks cannot prove npm trust or live
GitHub synchronization; verify the saved settings and installed candidate separately.
