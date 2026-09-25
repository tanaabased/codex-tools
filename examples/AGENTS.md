# Codex Tools Examples

The README files below `examples/` are executable Leia scenarios consumed by pull-request CI.
They run the built or packed `dist/codex-tools` executable and must use disposable state only. Local Leia
execution requires an explicit request.

## Scenario style

- Use focused, behavior-named `# should` blocks. Each blank-line-separated block runs in a fresh
  shell, so reconstruct state from files or keep dependent operations in one block.
- Keep sample plugins beside their scenarios; put test helpers and fake commands in `.fixtures/`.
  Keep `test/` flat and reserved for unit tests.
- Use `TMPDIR` for mutable copies, logs, homes, caches, and generated state. Never mutate checked-in
  fixture sources or an operator's Codex home.
- Keep blocks to setup, public CLI commands, and short assertions. Prefer shell comparisons; use
  JavaScript only for structured semantics or process coordination. Keep product assertions visible.
- Assert observable output, exit status, or file state. A zero exit alone is not evidence of the
  behavior named by the block.
- Capture expected nonzero results before inspecting their output; do not weaken the workflow with
  `|| true`.

## Ownership

- `defaults` owns the unoverridden source and Codex-home defaults.
- `inputs` owns help, version, option forms, environment precedence, booleans, JSON/debug output,
  and invalid input.
- `install` owns dry runs, native child environments, and install failure exits.
- `symlink` owns linked-marketplace previews and invalid-link rejection.
- `refresh` owns native failure exits before source edits.
- `status` owns the read-only `status` and `doctor` interface.
- `cache` owns drift reporting, dry runs, synchronization, and convergence.
- `package` runs in Release Tests against the exact prepared tarball and owns installed Node CLI,
  library, declarations, payload, and bundled-runtime checks.

The fake child commands prove Codex Tools orchestration, not native Codex or registry compatibility.
`native` and `native-npm` own real Codex acquisition, preservation, and fresh-session discovery
under Leia on Linux and macOS. Never put `.fixtures/bin` on their PATH.

Shared example helpers and their flat Mocha tests live in `.fixtures/` and `.fixtures/test/`.
Scenario-specific helpers stay beside their README. CI uses one scenario per matrix entry.
