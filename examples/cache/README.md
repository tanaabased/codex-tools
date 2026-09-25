# Cache reconciliation

Check drift, preview changes, and synchronize a raw target while preserving unmanaged files.

## Testing

```bash
# should report drift without changing the target
source environment.sh
mkdir "$root/cache"
printf 'stale payload\n' >"$root/cache/payload.txt"
status=0
codex-tools cache check --repo-root source --cache-path "$root/cache" --missing-target create >"$root/result.txt" || status=$?
test "$status" -eq 1
grep -F 'status: drifted' "$root/result.txt"
grep -F 'changed: payload.txt' "$root/result.txt"
grep -Fx 'stale payload' "$root/cache/payload.txt"

# should leave a dry-run target absent
source environment.sh
codex-tools cache sync --repo-root source --cache-path "$root/cache" --missing-target create --dry-run | grep -F 'status: planned'
test ! -e "$root/cache"

# should synchronize and converge without removing unmanaged files
source environment.sh
mkdir "$root/cache"
printf 'preserve\n' >"$root/cache/unmanaged.txt"
codex-tools cache sync --repo-root source --cache-path "$root/cache" --missing-target create
codex-tools cache sync --repo-root source --cache-path "$root/cache" --missing-target create
codex-tools cache check --repo-root source --cache-path "$root/cache" --missing-target create | grep -F 'status: synchronized_directory'
cmp source/payload.txt "$root/cache/payload.txt"
grep -Fx 'preserve' "$root/cache/unmanaged.txt"
```
