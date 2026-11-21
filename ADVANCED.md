# Advanced usage

Configure a marketplace or choose which files to sync.
Start with the [README](./README.md) for installation.

## Marketplace ownership

Codex Tools creates `~/.agents/plugins/marketplace.json` when it needs a personal marketplace and
preserves existing entries. Keep a repository-owned catalog and its mappings outside the source’s
managed paths and plugin resources. Without `managedPaths`, use a catalog outside the source tree.

Use an existing local marketplace by name, or register an explicit local catalog root during
installation:

```sh
codex-tools install /path/to/plugin \
  --marketplace team \
  --marketplace-path /path/to/market/.agents/plugins/marketplace.json
```

`--codex-home` selects Codex configuration and cache state. The personal marketplace stays under
your home directory.

## Cache ownership

The source `package.json#codexTools` object can select cache ownership and absence behavior:

```json
{
  "codexTools": {
    "managedPaths": [".codex-plugin", "package.json", "skills", "references", "scripts"],
    "excludeNames": [],
    "missingTarget": "require-installed",
    "absentCheck": "fail"
  }
}
```

Omit `managedPaths`, or set it to `null`, for whole-tree selection. `.git`, `node_modules`, and
`.DS_Store` are always excluded. `excludeNames` adds consumer-owned basename exclusions.

`managedPaths` controls cache reconciliation. Codex uses its own file selection during installation.

To sync files into a directory outside the Codex cache, use an explicit target:

```sh
codex-tools cache sync \
  --repo-root /path/to/plugin \
  --cache-path /tmp/payload \
  --missing-target create \
  --dry-run
```

Remove `--dry-run` to apply the sync. An applied raw-target sync reports `synchronized_directory`.
