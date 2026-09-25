# Plugin installation

Check that an install dry run remains offline and side-effect free. The `native` and
`native-npm` examples exercise real plugin acquisition.

## Testing

```bash
# should plan installation without starting Codex or creating state
source environment.sh
codex-tools install source --dry-run | grep -F 'status: planned'
test ! -e "$CODEX_HOME"
test ! -e "$HOME/.agents"
test ! -e "$XDG_CACHE_HOME"
```
