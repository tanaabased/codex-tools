# Default selection

Inspect the current directory using the `HOME/.codex` fallback without selection overrides.

## Testing

```bash
# should inspect the current source and default Codex home
source ../.fixtures/environment.sh
unset CODEX_HOME
target="$HOME/.codex/plugins/cache/personal/default-example/1.0.0"
mkdir -p "$target"
cp -R source/. "$target"
cd source
codex-tools status --json >"$root/status.json"
grep -F '"status":"current"' "$root/status.json"
grep -F "\"path\":\"$PWD\"" "$root/status.json"
grep -F "\"codexHome\":\"$HOME/.codex\"" "$root/status.json"
```
