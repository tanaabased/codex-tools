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

Inspect one Codex plugin and apply the requested refresh or managed-cache repair through the bundled
Codex Tools runtime.

## When to Use

- Diagnose installation health, compatibility, registration, enablement, or payload drift.
- Refresh a local source or pinned npm release, or reconcile managed cache content.

## When Not to Use

- For first installation or an npm release change, use `$tanaab-codex-tools-setup`.
- Do not publish packages or repair unrelated Codex configuration.

## Preconditions

- Resolve `<plugin-root>` two directories above this `SKILL.md`. Use its `dist/codex-tools`
  executable; never substitute a checkout or global executable.
- Require Node; npm refresh also needs npm.
- Resolve the intended source and any explicit Codex home, marketplace, or cache path.

## Workflow

1. Run `<plugin-root>/dist/codex-tools --version`. Stop if missing or mismatched with the plugin
   package version.
2. Inspect with `status --repo-root <plugin-path> --json` (`doctor` is an alias), or use
   `cache check --repo-root <plugin-path> --json` for managed payload drift.
3. Select the repair:
   - `refresh <plugin-path>` reinstalls changed local source.
   - `refresh npm:<package>` reinstalls the exact recorded npm release.
   - `cache sync` reconciles the selected managed cache; it does not install a plugin.
4. Preview the chosen command with `--dry-run --json`. Review the source, target, marketplace,
   planned writes, preservation behavior, and unresolved native checks.
5. When the request authorizes repair, repeat the reviewed command without `--dry-run`.
6. Re-run `status` or `cache check` as appropriate and report the observed outcome.

## Checkpoints

- An inspection request does not authorize mutation. Preserve reviewed selectors and targets.
- Refuse ambiguous targets, preserve unmanaged and excluded content, and retain npm release pins.
- Report partial native effects and retained source edits without promising rollback.

## Completion Criteria

- Diagnosis ends without filesystem writes or child processes.
- Repair has a matching final check that demonstrates convergence or identifies remaining problems.
- Installation, authentication, activation, and payload claims remain distinct.

## Bundled Resources

- [CLI](../../CLI.md): options, precedence, and failure contract.
- `../../dist/codex-tools`: packaged Node runtime.

## Validation

Confirm the bundled runtime and any mutation matched the requested repair, and that final status or
cache readback supports the reported outcome. Keep unobserved authentication and activation unknown.
