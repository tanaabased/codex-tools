# Installation status

Exercise the equivalent read-only status and doctor interfaces against disposable installations.

## Testing

```bash
# should report equivalent status and doctor results
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
target="$root/home/plugins/cache/personal/status-example/1.0.0"
mkdir -p "$target"
cp -R source/. "$target"
codex-tools status --repo-root source --codex-home "$root/home" --json >"$root/status.json"
codex-tools doctor --repo-root source --codex-home "$root/home" --json >"$root/doctor.json"
bun -e 'const a = await Bun.file(process.argv[1]).json(); const b = await Bun.file(process.argv[2]).json(); delete a.command; delete b.command; if (!a.ok || a.status !== "current" || JSON.stringify(a) !== JSON.stringify(b)) process.exit(1)' "$root/status.json" "$root/doctor.json"

# should treat neutral absence as a successful read-only observation
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
output=$(codex-tools status --repo-root source --codex-home "$root/home" --absent-check neutral --json)
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (!r.ok || r.status !== "not_installed" || r.inspection.installed) process.exit(1)'
test ! -e "$root/home"
```
