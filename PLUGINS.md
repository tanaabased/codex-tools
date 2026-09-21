# Codex Tools for agents

Use the setup and maintenance skills in Codex or OpenClaw to manage Codex plugins.
Start with the [README](./README.md#use-with-an-agent) for example requests.
The agent needs file and command execution tools, Node, and the
[supported Codex CLI](./CLI.md#invocation) for installation and refresh. npm sources also require npm.

The npm commands below require a published package. For unpublished builds, use
[local candidate installation](./CONTRIBUTING.md#install-a-local-release-candidate).

## Codex

Install the [CLI](./README.md#install), then use it to install its own plugin at the same version:

```sh
version="$(codex-tools --version)"
codex-tools install "npm:@tanaab/codex-tools@$version" --dry-run --json
codex-tools install "npm:@tanaab/codex-tools@$version"
```

Codex Tools registers the personal marketplace automatically. For a published prerelease,
bootstrap the CLI with `npm install --global @tanaab/codex-tools@edge` before these commands.
Start a fresh Codex task and select a skill or name it explicitly; see
[Codex plugin usage](https://developers.openai.com/codex/plugins/).

## OpenClaw

Install the same package as a compatible skill bundle:

```sh
openclaw plugins install npm:@tanaab/codex-tools
openclaw plugins inspect codex-tools
```

Use `npm:@tanaab/codex-tools@edge` for a published prerelease. Enable the bundle if required by
your host policy, then start a new agent session. See
[OpenClaw's compatible bundles](https://docs.openclaw.ai/plugins/bundles) for host requirements.
The skills manage Codex state on the machine where they run; they do not manage OpenClaw plugins.

## Use the skills

- **`$tanaab-codex-tools-setup`:** preview and install local or npm-backed Codex plugins.
- **`$tanaab-codex-tools-maintenance`:** inspect installations, refresh source plugins, and reconcile cache drift.

Both skills invoke `dist/codex-tools` inside their installed bundle, so agent execution does not
depend on a global Codex Tools command. Keep the complete bundle together rather than copying out
individual skill folders. Inspection is read-only; installation and repairs preview changes before
applying an authorized operation.
