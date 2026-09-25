# Refresh failure

Check the CLI's native failure exit and unchanged source when refresh fails preflight.
Successful local and pinned npm refreshes live in `native` and `native-npm`.

## Testing

```bash
# should preserve the native failure exit without editing the source manifest
source ../.fixtures/environment.sh
export PATH="$fixtures/bin:$PATH"
cp -R source "$root/source"
codex-tools install "$root/source"
status=0
FAKE_CODEX_EXIT=37 codex-tools refresh "$root/source" --json >"$root/result.json" || status=$?
test "$status" -eq 37
grep -F '"status":"incomplete"' "$root/result.json" | grep -F '"exitCode":37'
cmp source/.codex-plugin/plugin.json "$root/source/.codex-plugin/plugin.json"
```
