# Disposable cache

Exercise dry run, raw-target creation, and convergence without touching an installed plugin.

## Testing

```bash
# should leave a dry-run target absent
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
codex-tools cache sync --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create --dry-run --json | bun -e 'const r = await Bun.stdin.json(); if (r.status !== "planned" || r.inspection.installed) process.exit(1)'
test ! -e "$root/cache"

# should synchronize a raw directory and preserve unmanaged content
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/cache"
touch "$root/cache/unmanaged"
codex-tools cache sync --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create
cmp source/payload.txt "$root/cache/payload.txt"
test -f "$root/cache/unmanaged"
codex-tools cache sync --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create
codex-tools cache check --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create --json | bun -e 'const r = await Bun.stdin.json(); if (!r.ok || r.status !== "synchronized_directory" || r.inspection.installed) process.exit(1)'
```
