# Contributing to Codex Tools

Use the [README](./README.md) for installation and the [CLI guide](./CLI.md) for command behavior.

## Development

Use the Bun version in `.bun-version` for source work and Node from `.node-version` for built and
packed consumers. Install dependencies without lifecycle scripts:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run codex-tools --help
```

Run the source checks after code changes:

```sh
bun run lint
bun run typecheck
bun run test
```

Lint includes ESLint, Prettier, generated API drift, and local documentation links. Use
`bun run format:write` for formatting. Edit public TypeScript docblocks and run `bun run docs:api`
to update [API.md](./API.md); do not edit the generated reference directly.

## Artifact and integration checks

| Command                   | Owned contract                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build`           | Node CLI, ESM/CommonJS bundles, and matching declarations                                                                               |
| `bun run test:package`    | Builds, packs, and exercises the exact payload in a disposable Node consumer, including skills, assets, documentation, and type exports |
| `bun run test:native`     | Builds and checks local installation, refresh, and preservation through real Codex                                                      |
| `bun run test:native:npm` | Builds and checks npm acquisition through a disposable HTTPS registry                                                                   |

Run package checks for build, packaging, shipped documentation, or artifact-contract changes.
Run native checks for changes to native compatibility or the probes themselves. Nothing is published.

PR CI runs the six Leia scenarios against `dist/codex-tools` and validates the plugin through
`tanaabased/actions/validate-codex-plugin@v1`. Run Leia locally only when explicitly requested.
Its fake child commands verify orchestration; the Native Codex Verification workflow also installs
the packed plugin, checks fresh-session skill discovery, and invokes its cached runtime.
