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
---

# Codex Plugin Setup

## Overview

Install one local or npm-backed Codex plugin through the bundled Codex Tools runtime.

## When to Use

- Install a local plugin or an npm package selected by version, tag, range, or default `latest`.
- Preview an installation or verify its native readback.

## When Not to Use

- For inspection, refresh, or cache repair, use `$tanaab-codex-tools-maintenance`.
- For CLI bootstrap, follow the [README](../../README.md). Do not publish packages or modify plugin
  implementation as part of installation.

## Preconditions

- Resolve `<plugin-root>` two directories above this `SKILL.md`. Use its `dist/codex-tools`
  executable; never substitute a checkout or global executable.
- Require Node and npm for npm selectors.
- Preserve the caller's home, npm configuration, and explicit marketplace and Codex-home options.

## Workflow

1. Run `<plugin-root>/dist/codex-tools --version`. Stop if missing or mismatched with the plugin
   package version.
2. Select `install <plugin-path>` or `install npm:<package>[@selector]`. Resolve relative source
   paths explicitly.
3. Run with `--dry-run --json` and the selected options. Review source, home, marketplace, mapping,
   planned writes, and unresolved checks. npm resolution and native compatibility remain pending.
4. When the request authorizes installation, repeat the reviewed command without `--dry-run`.
5. Read the result against the completion criteria below. Tell the user to start a fresh Codex
   task for skill discovery; installation alone does not prove authentication or active-task loading.

## Checkpoints

- Stop on ambiguous targets, collisions, invalid manifests, or unexpected paths.
- Preserve the reviewed selector and options when applying. Report partial effects without promising
  rollback or blindly retrying.

## Completion Criteria

- The result is `ok: true`, with installed and, when observable, enabled readback.
- npm sources have an exact recorded release and verified cached payload.
- Unrelated marketplace entries and cache content remain preserved.

## Bundled Resources

- [CLI](../../CLI.md): selectors, options, output, and failure contract.
- `../../dist/codex-tools`: packaged Node runtime.

## Validation

Confirm the bundled runtime, reviewed dry run, authorized command, and native readback support the
reported outcome. Keep unobserved authentication and activation state unknown.
