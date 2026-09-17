# Codex Tools

One Bun-first TypeScript ESM package. Keep public bin entrypoints thin, orchestration in
lib/, small helpers in utils/, internal commands in scripts/, and flat tests in test/.
Use the canonical TypeScript, standalone ESLint, and Prettier configurations.

Keep install.ts as the public install selector, native-install.ts as shared installation
orchestration, codex-native.ts as the Codex process contract, and npm redaction in npm-install.ts.

Cache selection and compatibility belong to consumers. Never hardcode a marketplace,
home directory, or consumer name. Refuse ambiguous write targets, inspect before mutation,
preserve unmanaged entries, and verify convergence. Tests use disposable roots only.

Run bun run lint, bun run typecheck, bun run test, and bun run test:package.
Leia scenarios run against dist/codex-tools in PR checks; do not run them locally unless requested.
Use Bun for source validation and .node-version for Node artifact and package validation.
Release publication and plugin packaging are separate work.
