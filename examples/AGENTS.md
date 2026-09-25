# Codex Tools Examples

The README files below `examples/` are executable Leia scenarios consumed by pull-request CI.
They run the built `dist/codex-tools` executable and must use disposable state only. Local Leia
execution requires an explicit request.

## Scenario style

- Use focused, behavior-named `# should` blocks. Each blank-line-separated block runs in a fresh
  shell, so reconstruct state from files or keep dependent operations in one block.
- Keep fixtures beside the scenario that owns them. The shared `fixtures/bin` commands are the one
  exception: they model the Codex and npm child-process boundary used by install and refresh.
- Use `TMPDIR` for mutable copies, logs, homes, caches, and generated state. Never mutate checked-in
  fixture sources or an operator's Codex home.
- Assert observable output, exit status, or file state. A zero exit alone is not evidence of the
  behavior named by the block.
- Capture expected nonzero results before inspecting their output; do not weaken the workflow with
  `|| true`.

## Ownership

- `defaults` owns the unoverridden source and Codex-home defaults.
- `inputs` owns help, version, option forms, environment precedence, booleans, JSON/debug output,
  and invalid input.
- `install` owns local and npm installation journeys.
- `symlink` owns linked marketplace preservation, repository self-install, and invalid-link rejection.
- `refresh` owns local cachebuster refresh and pinned npm refresh.
- `status` owns the read-only `status` and `doctor` interface.
- `cache` owns drift reporting, dry runs, synchronization, and convergence.

The fake child commands prove Codex Tools orchestration, not native Codex or registry compatibility.
Real Codex and npm integration stays in the isolated native-verification workflow.
