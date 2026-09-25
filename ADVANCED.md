# Advanced usage

Operational details for marketplace ownership, npm acquisition, and cache reconciliation.
Start with the [README](./README.md); use the [CLI reference](./CLI.md) for flags and exit codes.

## Marketplace ownership

The default personal marketplace is `~/.agents/plugins/marketplace.json`. Existing marketplace
metadata, policies, entry order, unrelated entries, and matching source links are preserved.
Valid links on marketplace paths survive installation. Repository-owned catalogs and mappings must
remain outside the selected payload, including manifests and declared resources; without
`managedPaths`, the whole source is selected. Installation state stays outside the source.
`managedPaths` does not control what native Codex copies.

Use an existing local marketplace by name, or register an explicit local catalog root during
installation:

```sh
codex-tools install /path/to/plugin \
  --marketplace team \
  --marketplace-path /path/to/market/.agents/plugins/marketplace.json
```

`--codex-home` selects Codex configuration and cache state; the personal marketplace still belongs
to `HOME`.

## Managed Codex CLI

Install and refresh select the pinned official Codex release for macOS or Linux on arm64 or x64.
Codex Tools downloads that platform archive from the OpenAI GitHub release, verifies its published
SHA-256 digest, validates the exact CLI version, and atomically promotes the executable. It never
falls back to a `codex` command on `PATH`.

The cache lives under
`$XDG_CACHE_HOME/codex-tools/codex/<version>/<target>` when `$XDG_CACHE_HOME` is set, otherwise
`$HOME/.cache/codex-tools/codex/<version>/<target>`. A valid cached executable is reused offline.
If the executable is damaged but its verified archive remains valid, Codex Tools rebuilds it
offline. Otherwise, it stages and verifies a replacement before changing the cached executable; an
unsupported host, unavailable asset, invalid archive, or digest mismatch fails without invoking a
host CLI. Remove only the affected version/target directory when manual cache reset is necessary.

Dry runs, `status`, `doctor`, and `cache check` neither download nor invoke Codex.

## npm acquisition

npm aliases, Git or URL dependencies, filesystem acquisition, empty selectors, and malformed
selectors are rejected. Registry URLs must use HTTPS and contain no embedded credentials, query,
or fragment. Keep credentials in npm user configuration or npm environment settings; project-only
`.npmrc` authentication is insufficient because Codex performs acquisition outside the project.

Codex Tools resolves an exact release, asks Codex to acquire it, validates the acquired plugin
identity and declared resources, then pins the package release in marketplace provenance. Package
lifecycle scripts remain disabled by native Codex. Raw npm and Codex npm failure output is withheld
because it can echo credentials.

An npm refresh retains the exact installed release, even if its original tag or range now resolves
to a newer version. Use `install npm:<selector>` to select a different release.

## Refresh and recovery

Review and commit the manifest edit in the plugin repository. If refresh fails after applying the
edit, the cachebuster remains; completed marketplace or native effects are not rolled back.
Payload symlinks are rejected because native Codex does not copy them completely.

Partial failures report completed and remaining operations. Inspect `status --json` before retrying;
resolve the reported conflict rather than deleting marketplace or cache state wholesale. Successful
installation verifies disk state, not authentication or activation in an existing Codex task.

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

Raw-target creation is an explicit compatibility mode, not installation:

```sh
codex-tools cache sync \
  --repo-root /path/to/plugin \
  --cache-path /tmp/payload \
  --missing-target create \
  --dry-run
```

Remove `--dry-run` to create or synchronize the directory. The result is
`synchronized_directory`, never `installed`. See the executable
[cache scenarios](https://github.com/tanaabased/codex-tools/tree/main/examples/cache) and
[default-selection scenario](https://github.com/tanaabased/codex-tools/tree/main/examples/defaults).
