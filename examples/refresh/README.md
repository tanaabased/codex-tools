# Refresh preconditions

Check that refresh rejects missing installation state before native acquisition or editing the
source. Successful local and pinned npm refreshes live in `native` and `native-npm`.

## Testing

```bash
# should reject missing marketplace state without acquisition or source edits
source environment.sh
cp -R source "$root/source"
status=0
codex-tools refresh "$root/source" >"$root/result.txt" 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F 'Refresh requires an existing local marketplace' "$root/error"
cmp source/.codex-plugin/plugin.json "$root/source/.codex-plugin/plugin.json"
test ! -e "$XDG_CACHE_HOME"
```
