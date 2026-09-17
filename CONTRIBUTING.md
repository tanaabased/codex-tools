# Contributing to Codex Tools

This guide covers source development and validation. Start with the [README](./README.md) for the
user journey, [CLI](./CLI.md) for command behavior, and generated [API reference](./API.md) for the
public library contract.

## Setup

Install Bun 1.3.14 from `.bun-version` and Node 26.9.0 from `.node-version`, then install the locked
dependencies without lifecycle scripts:

```sh
bun install --frozen-lockfile --ignore-scripts
```

Bun owns source execution, generation, linting, type checking, and unit tests. Node owns validation
of the built CLI, ESM/CommonJS library artifacts, declarations, and packed consumer experience.
There is no separate JavaScript source layer or Node 24 compatibility job.

## Develop and validate

```sh
# Run the TypeScript CLI directly.
bun run codex-tools --help

# Regenerate the public API reference after changing exports or docblocks.
bun run docs:api

# Run the standard local validation path.
bun run lint
bun run typecheck
bun run test
bun run test:package
```

`bun run lint` includes ESLint, Prettier, API-reference drift, and local documentation-link checks.
`bun run test:package` builds the Node artifacts, inspects the exact npm payload, installs its
tarball into a disposable consumer, and exercises the CLI, ESM, CommonJS, and TypeScript contracts.
Nothing is published.

Use `bun run format:write` to apply repository formatting. Edit public TypeScript documentation
comments or the generator rather than editing `API.md` by hand.

## Additional checks

Run these only when the change owns their boundary:

- `bun run build` builds the Node CLI, ESM/CommonJS libraries, and matching declarations.
- `bun run test:native` exercises local installation and refresh against a disposable Codex home.
- `bun run test:native:npm` adds a disposable HTTPS npm registry and npm-backed installation.

The six Leia scenarios in `examples/` run against `dist/codex-tools` in pull-request CI. Do not run
them locally unless explicitly requested. The fake child commands prove Codex Tools orchestration;
native verification owns real Codex and npm compatibility.

## Source boundaries

- `bin/` contains the thin public CLI entrypoint.
- `lib/` contains orchestration and the public package entrypoint.
- `utils/` contains small, independently testable helpers.
- `scripts/` contains internal build, generation, and validation commands.
- `test/` contains flat unit and contract tests.
- `examples/` contains disposable executable user journeys.

Keep public exports explicit in `lib/index.ts`. Imports through internal paths are unsupported.
Release publication and Codex plugin packaging remain separate work.
