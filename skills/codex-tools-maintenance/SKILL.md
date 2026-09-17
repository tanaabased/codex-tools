---
name: tanaab-codex-tools-maintenance
description: Tanaab-based Codex plugin maintenance using the packaged Codex Tools CLI. Use when inspecting installation health, diagnosing drift, refreshing a plugin, or reconciling its managed cache.
license: MIT
metadata:
  type: workflow
  owner: tanaab
  tags:
    - tanaab
    - workflow
    - codex
  openclaw:
    emoji: '🩺'
    homepage: https://github.com/tanaabased/codex-tools/tree/main/skills/codex-tools-maintenance
    requires:
      bins:
        - node
---

# Codex Plugin Maintenance

## Overview

Inspect and maintain one Codex plugin through the packaged Codex Tools runtime. Begin with read-only
status or cache checks, distinguish source drift from installation problems, and apply only the
refresh or managed-cache repair the user requested.

## When to Use

- Inspect a plugin's source identity, compatibility, registration, enabled state, or payload drift.
- Diagnose a local or npm-backed installation with `status` or its `doctor` alias.
- Refresh an existing installation from its selected local source or pinned npm release.
- Check or synchronize managed cache content while preserving unmanaged entries.

## When Not to Use

- Do not use this skill for first-time installation; use `$tanaab-codex-tools-setup`.
- Do not use refresh to upgrade an npm plugin: npm refresh deliberately retains the pinned release.
- Do not publish a package, prepare a release, or repair unrelated Codex configuration.

## Preconditions

- Resolve the plugin root as two directories above this `SKILL.md`. Invoke the absolute bundled
  executable at `<plugin-root>/dist/codex-tools` directly; never substitute a checkout path or a
  global `codex-tools` executable.
- Require Node. Refresh additionally requires a compatible Codex CLI, and npm refresh requires npm.
- Resolve the intended plugin source and any explicit Codex home, marketplace, or cache path before
  selecting an operation.
- Treat read-only diagnosis as distinct from repair. A request to inspect does not authorize
  refresh or cache synchronization.

## Workflow

1. Resolve the bundled executable, run `<plugin-root>/dist/codex-tools --version`, and stop if it is
   missing or does not match the plugin package version. Do not fall back to another executable.
2. Inspect before mutation:
   - Use `status --repo-root <plugin-path> --json` or the `doctor` alias for installation health.
   - Use `cache check --repo-root <plugin-path> --json` when the question is managed payload drift.
3. Classify the result before recommending action:
   - Use `refresh <plugin-path>` for an installed local plugin whose source payload changed.
   - Use `refresh npm:<package>` to reinstall the exact recorded npm release.
   - Use `cache sync` only for the selected managed cache contract; it is not plugin installation.
   - Use setup with a new npm selector when the user wants another package release.
4. For `refresh` or `cache sync`, run the chosen command with `--dry-run --json` first. Review the
   selected source, target, marketplace, planned writes, preservation behavior, and unresolved
   native checks.
5. When the user's request authorizes the repair, repeat the same command without `--dry-run`.
   Preserve every selector and target from the reviewed plan.
6. Re-run `status` or `cache check` as appropriate. Report observed convergence, incomplete
   operations, retained source edits, and any authentication or activation state that remains
   unknown.

## Checkpoints

- Diagnosis remains read-only until a requested repair operation is selected.
- Refresh uses the existing installation mapping and never silently changes an npm release.
- Cache synchronization preserves unmanaged and excluded content and refuses ambiguous targets.
- Partial native effects are reported rather than described as rolled back.

## Completion Criteria

- Read-only requests end with a structured diagnosis and no filesystem or child-process mutation.
- Repair requests have a reviewed dry run, an authorized apply step, and a matching final check.
- Managed cache repair converges without removing unmanaged content.
- Installation, authentication, activation, and payload claims remain separate and evidence-based.

## Bundled Resources

- [README](../../README.md): common status, refresh, and cache commands.
- [CLI](../../CLI.md): complete operation, option, precedence, and failure contract.
- `../../dist/codex-tools`: packaged Node runtime used by this skill.

## Validation

- Confirm the resolved executable is inside this installed plugin and its version matches the
  plugin package.
- Confirm the initial command was read-only and any mutation matched the user's requested repair.
- Confirm the final status or cache check supports every completion claim.
