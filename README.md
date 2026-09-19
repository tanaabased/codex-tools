# Codex Tools

<p align="center">
  <img src="./assets/codex-tools.png" alt="Codex Tools" width="180" />
</p>

Install, inspect, refresh, and reconcile Codex plugins without trampling unrelated local state.
Use the Node CLI or the typed JavaScript API; source development runs on Bun.

## Install

Requires Node `^24.15.0 || >=26.0.0`. Install and refresh also need a
[supported Codex version](./CLI.md#invocation-and-prerequisites).

```sh
npm install --global @tanaab/codex-tools
codex-tools --help
```

For library use, install locally with `npm install @tanaab/codex-tools`.

## Usage

### CLI

```sh
# Preview an installation, then apply it.
codex-tools install /path/to/plugin --dry-run --json
codex-tools install /path/to/plugin

# Install a published plugin package.
codex-tools install npm:@scope/plugin@1.2.3

# Inspect the installation and refresh its local source.
codex-tools status --repo-root /path/to/plugin --json
codex-tools refresh /path/to/plugin

# Report cache drift, then preview synchronization.
codex-tools cache check --repo-root /path/to/plugin
codex-tools cache sync --repo-root /path/to/plugin --dry-run
```

Dry runs write nothing and start no child processes. Commands refuse ambiguous targets and
preserve unrelated state. Local refresh edits the source manifest version; review and commit that edit.

See the [CLI reference](./CLI.md) for all commands, options, environment variables, and exit codes.

### Library

<!-- codex-tools-example:api -->

```ts
import { runOperation, type CodexToolsOptions } from '@tanaab/codex-tools';

const options: CodexToolsOptions = {
  repoRoot: '/path/to/plugin',
  codexHome: '/path/to/codex-home',
};
const result = await runOperation('status', options);

if (!result.ok) console.error(result.issue);
```

The package supports ESM imports and CommonJS `require`. Import from `@tanaab/codex-tools`;
internal paths are unsupported. The generated [API reference](./API.md) covers public functions,
types, results, and side effects.

## Advanced usage

See [advanced usage](./ADVANCED.md) for marketplace and cache ownership, npm pinning, recovery,
and the optional Codex skills.

## Development

See [CONTRIBUTING](./CONTRIBUTING.md) for source setup, generation, and validation.

## License

[MIT](./LICENSE). See [NOTICE](./NOTICE) for attribution.
