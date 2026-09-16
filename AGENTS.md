# Codex Tools

One Bun-first JavaScript ESM package. Keep public bin entrypoints thin, orchestration in
lib/, small helpers in utils/, internal commands in scripts/, and flat tests in test/.
Use the canonical standalone ESLint and Prettier configurations; no TypeScript layer
unless the repository adopts TypeScript.

Cache selection and compatibility belong to consumers. Never hardcode a marketplace,
home directory, or consumer name. Refuse ambiguous write targets, inspect before mutation,
preserve unmanaged entries, and verify convergence. Tests use disposable roots only.

Run bun run lint, bun run test, and bun run test:package.
Leia scenarios run against dist/codex-tools in PR checks; do not run them locally unless requested.
Release publication and plugin packaging are separate work.
