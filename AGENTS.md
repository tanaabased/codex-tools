# Codex Tools

## Scope and ownership

- Own local and npm plugin installation, inspection, refresh, and consumer-defined cache reconciliation.
- Keep the public launcher in `bin/`, runtime orchestration in `lib/`, narrow helpers in `utils/`,
  and flat tests in `test/`. Export the supported API explicitly from `lib/index.ts`.
- Keep `install.ts` as the source selector, `native-install.ts` as shared installation orchestration,
  `codex-native.ts` as the native process contract, and npm redaction in `npm-install.ts`.
- `dev/scripts/` owns internal commands; `dev/lib/` and `dev/utils/` own their implementation; `dev/test/` tests it. None ship.
- Read `examples/AGENTS.md` before changing scenarios or fixtures.

## Out of scope

- General Codex configuration, plugin authoring, and a replacement plugin validator.
- Authentication or active-task loading claims based only on successful installation.
- Release publication as incidental cleanup; npm delivery and plugin installation are distinct.

## Runtime and safety boundaries

- Preserve TypeScript ESM source, Bun development, and the Node CLI plus typed ESM/CommonJS artifacts.
  Keep `.bun-version` aligned with `package.json#packageManager`; use `.node-version` for artifacts.
- Cache selection and compatibility belong to consumers. Never hardcode a marketplace, home,
  or consumer. Refuse ambiguous targets, preserve unmanaged content, and verify convergence.
- Status and checks are read-only. Dry runs write nothing and start no child processes.
- Local refresh edits the source cachebuster; npm refresh retains the pinned release.
  Report partial effects honestly; do not promise rollback.
- Keep tests and native probes inside disposable roots, away from the operator's Codex state.

## Test ownership and validation

- Unit tests own parsing, operation policy, and safety decisions. Leia owns built CLI journeys;
  package checks own the packed payload, Node entrypoints, and ESM/CommonJS runtime and type exports.
- Native probes own real Codex acquisition and fresh-session discovery. Fakes cannot prove these.
- Keep ESLint and standalone Prettier separate; keep type-checking separate from lint.
- Run `bun run check:toolchain`, `bun run docs:check`, `bun run lint`, `bun run typecheck`, and `bun run test` for source changes; add
  `bun run build && bun run check:package` for build, packaging, shipped documentation, or artifact-contract changes.
- Run native probes when changing their helpers or native compatibility. Leia scenarios stay in
  PR CI unless explicitly requested locally. See CONTRIBUTING for commands.

## Documentation and skills

- README owns onboarding, CLI owns command reference, ADVANCED owns operational detail,
  CONTRIBUTING owns development, and public
  TypeScript docblocks own generated API.md. Regenerate it with `bun run docs:api`.
- Give each explanation one home. Delete repetition and obvious comments before adding guides.
- Skills use namespace `tanaab` and container `codex-plugin`. Preserve their public identities.
  Setup owns installation; maintenance owns diagnosis and repair. Both use the bundled runtime.
- Keep plugin/package versions aligned and ship every resource referenced by the skills.
