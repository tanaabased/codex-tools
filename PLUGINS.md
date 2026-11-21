# Codex Tools for agents

Install Codex Tools in Codex or OpenClaw to let an agent manage Codex plugins and
package skills for Codex Cloud. The skills need [Node](./README.md#install) and file and command access. npm-backed
plugins also need npm.

## Codex

```sh
npx @tanaab/codex-tools install npm:@tanaab/codex-tools
```

`npx` fetches Codex Tools as needed. Codex Tools provisions the Codex CLI and installs the plugin.

## OpenClaw

```sh
openclaw plugins install npm:@tanaab/codex-tools
```

Enable the bundle if your host requires it. The skills manage Codex on the machine where the agent
runs. See [OpenClaw’s bundle requirements](https://docs.openclaw.ai/plugins/bundles).

## First run

Start a fresh Codex task or OpenClaw session and paste this prompt.

> Use `$tanaab-codex-tools-setup` to help me install a Codex plugin. Ask me for its folder or npm package, then show me the installation plan before making changes.

## Skills

| Skill                                                                          | Use it to                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`$tanaab-codex-tools`](./skills/codex-tools/SKILL.md)                         | Choose the CLI or library, or package and verify skills for Codex Cloud.                      |
| [`$tanaab-codex-tools-setup`](./skills/codex-tools-setup/SKILL.md)             | Preview or apply a local or npm plugin installation, then check the result.                   |
| [`$tanaab-codex-tools-maintenance`](./skills/codex-tools-maintenance/SKILL.md) | Inspect a plugin or its cache, refresh the installed plugin, or sync its managed cache files. |
