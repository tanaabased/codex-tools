# Plugin installation

Check dry runs, child environments, and failure exits with deterministic Codex responses.
The `native` and `native-npm` examples exercise real acquisition.

## Testing

```bash
# should plan installation without starting Codex or creating state
source environment.sh
export PATH="$PWD/bin:$PATH" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
codex-tools install source --dry-run | grep -F 'status: planned'
test ! -e "$root/children.log"
test ! -e "$CODEX_HOME"
test ! -e "$HOME/.agents"

# should pass the selected home and cache to the native child
source environment.sh
export PATH="$PWD/bin:$PATH"
cp -R source "$root/source"
codex-tools install "$root/source" | grep -F 'status: installed'
cmp source/payload.txt "$CODEX_HOME/plugins/cache/personal/fixture-local/1.0.0/payload.txt"
test -f "$HOME/.agents/plugins/marketplace.json"

# should preserve a native failure exit in CLI JSON without writing a catalog
source environment.sh
export PATH="$PWD/bin:$PATH"
status=0
FAKE_CODEX_EXIT=37 codex-tools install source --json >"$root/result.json" 2>"$root/error" || status=$?
test "$status" -eq 37
grep -F '"status":"incomplete"' "$root/result.json" | grep -F '"exitCode":37'
test ! -s "$root/error"
test ! -e "$HOME/.agents/plugins/marketplace.json"
```
