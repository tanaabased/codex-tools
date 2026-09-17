# Cache reconciliation

Exercise drift reporting, dry runs, raw-target creation, unmanaged-file preservation, and
convergence without claiming that the raw directory is an installed plugin.

## Testing

```bash
# should report drift without changing the target
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/cache"
printf 'stale payload\n' >"$root/cache/payload.txt"
printf 'preserve\n' >"$root/cache/unmanaged.txt"
set +e
output=$(codex-tools cache check --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create --json)
status=$?
set -e
test "$status" -eq 1
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (r.ok || r.status !== "drifted" || !r.diff.changed.includes("payload.txt")) process.exit(1)'
grep -Fx 'stale payload' "$root/cache/payload.txt"
grep -Fx 'preserve' "$root/cache/unmanaged.txt"

# should leave a dry-run target absent
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
codex-tools cache sync --repo-root source --codex-home "$root/home" --cache-path "$root/cache" --missing-target create --dry-run --json | bun -e 'const r = await Bun.stdin.json(); if (r.status !== "planned" || r.inspection.installed) process.exit(1)'
test ! -e "$root/cache"

# should synchronize a raw directory and converge without removing unmanaged files
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
