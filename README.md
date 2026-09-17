# Codex Tools

Install, inspect, refresh, and reconcile Codex plugins without trampling unrelated local state.
Codex Tools provides a Node CLI and a typed JavaScript API; the source is developed with Bun.

The distributed package requires Node `^24.15.0 || >=26.0.0`. Local plugin installation and
refresh support the Codex `0.153.x` CLI contract. Package publication and plugin publication are
separate operations.

## Install

Install the package globally when you want the `codex-tools` command on your path:

```sh
npm install --global @tanaab/codex-tools
codex-tools --help
```

From a source checkout, install the pinned Bun dependencies and run the TypeScript entrypoint:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run codex-tools --help
```

## Start with a dry run

Preview a local plugin installation before Codex Tools creates marketplace state or invokes Codex:

```sh
codex-tools install /path/to/plugin --dry-run --json
```

Remove `--dry-run` after reviewing the plan. A local plugin needs a
`.codex-plugin/plugin.json`; npm-backed installation accepts scoped or unscoped package selectors:

```sh
codex-tools install /path/to/plugin
codex-tools install 'npm:@scope/plugin@^1.2.0'
```

Codex Tools preserves unrelated marketplace entries and cache content. It refuses ambiguous or
unsafe write targets rather than guessing. Successful installation or refresh verifies disk state;
it does not claim that authentication succeeded or that an existing Codex task loaded the plugin.

## Common commands

```sh
# Inspect without repairing.
codex-tools status --repo-root /path/to/plugin --json

# Preview and then apply a local-plugin refresh.
codex-tools refresh /path/to/plugin --dry-run --json
codex-tools refresh /path/to/plugin

# Report cache drift, then synchronize the selected cache.
codex-tools cache check --repo-root /path/to/plugin
codex-tools cache sync --repo-root /path/to/plugin --dry-run
codex-tools cache sync --repo-root /path/to/plugin
```

`doctor` aliases `status`. Explicit flags override `CODEX_TOOLS_*` environment values, which
override repository settings and defaults. Read-only commands never repair state, and dry runs do
not write files or start child processes.

See the [CLI guide](./CLI.md) for commands, prerequisites, option precedence, output, and exit
codes. Its examples link to the executable Leia scenarios used in pull-request checks.

## Use the library

The package exposes the same operation layer used by the CLI:

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

Import only from `@tanaab/codex-tools`; `lib/`, `utils/`, `scripts/`, and `dist/` are private
implementation paths. The generated [API reference](./API.md) covers every supported runtime and
type export, including results, failures, and side effects.

## Develop

Source validation uses Bun 1.3.14. Node 26.9.0, pinned in `.node-version`, validates built and
packed artifacts:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run lint
bun run typecheck
bun run test
bun run test:package
```

See [CONTRIBUTING](./CONTRIBUTING.md) for generation, validation, and CI-owned checks.

## License and attribution

Codex Tools is licensed under the [MIT License](./LICENSE). See [NOTICE](./NOTICE) for attribution.
