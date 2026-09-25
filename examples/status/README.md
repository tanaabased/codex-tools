# Installation status

Inspect disposable installations through the read-only status and doctor commands.

## Testing

```bash
# should expose the same installation through status and doctor
source ../.fixtures/environment.sh
target="$CODEX_HOME/plugins/cache/personal/status-example/1.0.0"
mkdir -p "$target"
cp -R source/. "$target"
codex-tools status --repo-root source >"$root/status.txt"
codex-tools doctor --repo-root source >"$root/doctor.txt"
grep -F 'status: current' "$root/status.txt"
cmp "$root/status.txt" "$root/doctor.txt"

# should report neutral absence without creating a Codex home
source ../.fixtures/environment.sh
codex-tools status --repo-root source --absent-check neutral | grep -F 'status: not_installed'
test ! -e "$CODEX_HOME"
```
