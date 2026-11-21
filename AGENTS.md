# Codex Tools

## Scope and ownership

- Own local and npm plugin installation, inspection, refresh, and consumer-defined cache reconciliation.
- Keep the public launcher in `bin/` and the explicit API exports, shared operation dispatch, and
  public options in `codex/`. Keep cross-capability helpers in `utils/`.
- Runtime capabilities own their implementation in `cli/`, `install/`, `cache/`, and `cloud/`.
  Keep the source selector in `install/install.ts`, installation orchestration in
  `install/native-install.ts`, the native process contract in `install/codex-native.ts`, and npm
  redaction in `install/npm-install.ts`.
- Keep small capability folders flat, with specs beside the code they exercise. Add role folders
  when they improve navigation or isolate substantial fixtures.
- `build/` owns API generation, distribution builds, and toolchain checks. The repository
  Markdown link check lives under `cloud/` as a maintainer task. These tasks stay outside the
  shipped runtime.
- Preserve the three Cloud source re-exports in `lib/` while Canon imports those paths.
- Keep each example's assets and helpers inside that example, including copies shared by other examples.
  Read `examples/AGENTS.md` before changing scenarios or fixtures.

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

- Unit tests own parsing, operation policy, and safety decisions. Leia owns built CLI journeys
  in Example Tests, with every scenario on Ubuntu and macOS through one unconditional matrix.
- Release workflows own packing, plugin validation, and publication; do not add Leia or a separate
  packed-consumer suite to them.
- Use block-style lists for YAML arrays.
- Native Leia scenarios own real Codex acquisition and fresh-session discovery. Fakes cannot prove these.
- Keep ESLint and standalone Prettier separate; keep type-checking separate from lint.
- Run `bun run check:toolchain`, `bun run docs:check`, `bun run lint`, `bun run typecheck`, and `bun run test` for source changes; add
  `bun run build` for build, packaging, shipped documentation, or artifact-contract changes.
- Leia scenarios, including native compatibility, stay in PR CI unless explicitly requested locally.
  See CONTRIBUTING for commands.

## Documentation and skills

- README owns onboarding, CLI owns command reference, ADVANCED owns operational detail,
  CONTRIBUTING owns development, and public
  TypeScript docblocks own generated API.md. Regenerate it with `bun run docs:api`.
- Keep the README opening description stable. Revise it for a change in core capabilities or ways
  to use the product, or to correct an inaccurate claim.
- Keep code-comment prose lowercase, including docblocks and fenced examples; preserve literal identifiers.
- Give each explanation one home. Delete repetition and obvious comments before adding guides.
- Skills use namespace `tanaab` and container `codex-plugin`. Preserve their public identities.
  Codex Tools owns CLI and library selection and Cloud packaging. Setup owns installation, and
  maintenance owns diagnosis and repair. Use the project CLI first and the bundled CLI as fallback.
- Keep plugin/package versions aligned and ship every resource referenced by the skills.
