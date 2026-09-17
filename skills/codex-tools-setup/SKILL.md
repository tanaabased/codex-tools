---
name: tanaab-codex-tools-setup
description: Tanaab-based Codex plugin setup using the packaged Codex Tools CLI. Use when installing a local or npm-backed plugin, previewing its installation plan, or verifying installation readback.
license: MIT
metadata:
  type: workflow
  owner: tanaab
  tags:
    - tanaab
    - workflow
    - codex
  openclaw:
    emoji: '🧰'
    homepage: https://github.com/tanaabased/codex-tools/tree/main/skills/codex-tools-setup
    requires:
      bins:
        - node
        - codex
---

# Codex Plugin Setup

## Overview

Install one local or npm-backed Codex plugin through the packaged Codex Tools runtime. Preview the
exact plan, preserve unrelated marketplace state, apply the requested installation, and report what
native readback proves without claiming authentication or activation that it cannot observe.

## When to Use

- Install a local plugin directory containing `.codex-plugin/plugin.json`.
- Install an npm-backed plugin from an exact version, tag, range, or default `latest` selector.
- Preview an installation before Codex Tools creates marketplace state or invokes Codex.
- Verify the installed, enabled, and payload state reported after installation.

## When Not to Use

- Do not use this skill to install the Codex Tools CLI or bootstrap this skill itself; follow the
  package [README](../../README.md) first.
- Do not use it for routine inspection, refresh, or cache reconciliation; use
  `$tanaab-codex-tools-maintenance`.
- Do not publish packages, create releases, or edit a plugin's implementation as part of setup.

## Preconditions

- Resolve the plugin root as two directories above this `SKILL.md`. Invoke the absolute bundled
  executable at `<plugin-root>/dist/codex-tools` directly; never substitute a checkout path or a
  global `codex-tools` executable.
- Require Node and a Codex `0.153.x` CLI. Require npm only for an `npm:` selector.
- Identify one source: an absolute or explicitly resolved local plugin path, or an npm selector such
  as `npm:@scope/plugin@1.2.3`.
- Preserve the caller's `HOME`, `CODEX_HOME`, npm configuration, and requested marketplace options.

## Workflow

1. Resolve the bundled executable, run `<plugin-root>/dist/codex-tools --version`, and stop if it is
   missing or does not match the plugin package version. Do not fall back to another executable.
2. Choose the source form:
   - Local: `install <plugin-path>`.
   - npm: `install npm:<package>[@selector]`.
3. Run the selected command with `--dry-run --json` and any explicit `--codex-home`,
   `--marketplace`, or `--marketplace-path` values. A dry run plans only; npm resolution, native
   compatibility, and installation state may remain pending.
4. Review the JSON plan for the exact source, Codex home, marketplace, catalog path, mapping, and
   operations. Stop on ambiguous targets, collisions, invalid manifests, or unexpected paths.
5. When the user's request authorizes installation, repeat the same command without `--dry-run`.
   Do not change the selector or target between preview and application.
6. Interpret the final result. Require `ok: true`, an installed readback, and an enabled readback
   when observable. For npm sources, also require verified payload inspection and exact recorded
   provenance.
7. Tell the user that a fresh Codex task is required for skill discovery. Do not call an existing
   task's activation or authentication state proven.

## Checkpoints

- The dry run names one source, one marketplace, and one Codex home before any write or child
  process.
- The applied command uses the reviewed selector and options unchanged.
- Partial failures report completed and remaining operations; do not promise rollback or retry
  blindly.
- A successful native readback proves installation state, not live task activation.

## Completion Criteria

- Codex Tools reports a successful installation and observes the intended plugin in the selected
  marketplace.
- npm installation records the exact resolved package release and verifies the cached payload.
- Unrelated marketplace entries and cache content remain preserved.
- The user knows to begin a fresh Codex task before expecting the new skills to appear.

## Bundled Resources

- [README](../../README.md): CLI-first bootstrap and common setup path.
- [CLI](../../CLI.md): complete selectors, options, output, and exit-code contract.
- `../../dist/codex-tools`: packaged Node runtime used by this skill.

## Validation

- Confirm the resolved executable is inside this installed plugin and its version matches the
  plugin package.
- Confirm dry-run output was reviewed before any authorized installation.
- Confirm final claims match the structured readback and keep authentication and activation marked
  unknown when they were not observed.
