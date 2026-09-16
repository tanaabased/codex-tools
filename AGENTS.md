# Codex Tools

One Bun-first JavaScript ESM package. Keep public bin entrypoints thin, orchestration in
lib/, small helpers in utils/, internal commands in scripts/, and flat tests in test/.
Use the canonical standalone ESLint and Prettier configurations; no TypeScript layer
unless the repository adopts TypeScript.

Keep install.js as the public install selector, native-install.js as shared installation
orchestration, codex-native.js as the Codex process contract, and npm redaction in npm-install.js.

Cache selection and compatibility belong to consumers. Never hardcode a marketplace,
home directory, or consumer name. Refuse ambiguous write targets, inspect before mutation,
preserve unmanaged entries, and verify convergence. Tests use disposable roots only.

Run bun run lint, bun run test, and bun run test:package.
Leia scenarios run against dist/codex-tools in PR checks; do not run them locally unless requested.
Release publication and plugin packaging are separate work.
