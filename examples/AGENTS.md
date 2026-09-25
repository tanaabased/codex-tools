# Codex Tools Examples

The README files below `examples/` are executable Leia scenarios consumed by pull-request CI.
They run the built or packed `dist/codex-tools` executable and must use disposable state only. Local Leia
execution requires an explicit request.

## Scenario style

- Use focused, behavior-named `# should` blocks. Each blank-line-separated block runs in a fresh
  shell, so reconstruct state from files or keep dependent operations in one block.
- Keep sample plugins, assets, helpers, and fake commands inside the example that uses them.
  Copy shared inputs into each example instead of introducing a shared fixtures directory or
  importing from another example. Keep helper unit tests in that example's flat `test/` directory.
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
- `install` owns offline, side-effect-free install dry runs.
- `symlink` owns linked-marketplace previews and invalid-link rejection.
- `refresh` owns precondition failures before provisioning or source edits.
- `status` owns the read-only `status` and `doctor` interface.
- `cache` owns drift reporting, dry runs, synchronization, and convergence.

Unit tests own injected native failures and process orchestration. `native` and `native-npm` own
real Codex acquisition, preservation, and fresh-session discovery under Leia on Linux and macOS.
The `native` scenario keeps an incompatible host command on `PATH` solely to prove it is ignored.

CI runs every scenario on Ubuntu and macOS with the same preparation and one README per matrix
entry. Keep the matrix as explicit `os` and `example` lists, without includes or conditional steps.
