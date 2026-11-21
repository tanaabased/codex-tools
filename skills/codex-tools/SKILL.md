---
name: tanaab-codex-tools
description: 'Tanaab-based Codex Tools guidance. Use when choosing the CLI or library, integrating Codex Tools into JavaScript or TypeScript, or packaging and verifying Codex Cloud skills.'
license: MIT
metadata:
  type: workflow
  owner: tanaab
  tags:
    - tanaab
    - workflow
    - codex
  openclaw:
    emoji: '⌨️'
    homepage: 'https://github.com/tanaabased/codex-tools/tree/main/skills/codex-tools'
---

# Codex Tools

## Overview

Choose how to use Codex Tools and package skills for Codex Cloud.

## Required Reading

- **Before choosing a CLI launcher:** read [runtime selection](./references/runtime-selection.md).
- **Before running a command:** read its section of the [CLI reference](../../CLI.md).
- **Before writing JavaScript or TypeScript against Codex Tools:** read [API usage](../../API.md#usage) and the relevant API entries.
- **Before installing a plugin or changing its npm release:** read and follow [setup](../codex-tools-setup/SKILL.md).
- **Before inspecting, refreshing, or repairing an installed plugin:** read and follow [maintenance](../codex-tools-maintenance/SKILL.md).

## When to Use

- Choose an interface for a task that uses Codex Tools.
- Prepare a project's skills for Codex Cloud or verify them in a packaged release.

## When Not to Use

Use the project's own workflow for tasks outside Codex Tools, such as authoring skills or publishing a release.

## Preconditions

Identify the project or plugin and what the user wants to inspect, change, or integrate.

## Workflow

1. Use the CLI for commands run in a terminal or on the user's behalf in chat. Follow setup or maintenance for their respective workflows.
2. Use the public `@tanaab/codex-tools` library when JavaScript or TypeScript needs to call an operation and consume structured results. Use the project's declared dependency and documented exports. Use the CLI for Cloud packaging and verification.
3. For Cloud work, identify the project's config and selected skills. Use `cloud package` in a fresh checkout when preparing a release. It updates selected skill files in place. Use the project's pack step and run `cloud verify --package <extracted-package>` with the same source config when checking the resulting release.

## Checkpoints

- Keep the same launcher for preview, apply, and readback.
- For verification alone, run `cloud verify` against the supplied extracted package.

## Completion Criteria

Use the chosen workflow's result to report the outcome. For Cloud work, identify the skills prepared or verified and report any failures.

## Bundled Resources

- [Runtime selection](./references/runtime-selection.md)
- [CLI reference](../../CLI.md)
- [Public API](../../API.md)

## Validation

Inspect the result from the documented command or API. For Cloud release verification, use the extracted package rather than the source files alone.
