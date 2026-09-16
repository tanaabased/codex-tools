# Default selection

Exercise the current-directory source and `HOME/.codex` fallback without setting Codex Tools
selection flags or their environment equivalents.

## Testing

```bash
# should inspect the current source and default codex home
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
target="$root/home/.codex/plugins/cache/personal/default-example/1.0.0"
mkdir -p "$target"
cp -R source/. "$target"
output=$(cd source && env -u CODEX_HOME -u CODEX_TOOLS_CODEX_HOME -u CODEX_TOOLS_REPO_ROOT -u CODEX_TOOLS_CACHE_PATH HOME="$root/home" codex-tools status --json)
printf '%s' "$output" | EXPECTED_SOURCE="$PWD/source" EXPECTED_HOME="$root/home/.codex" bun -e 'const r = await Bun.stdin.json(); if (!r.ok || r.status !== "current" || r.source.path !== process.env.EXPECTED_SOURCE || r.codexHome !== process.env.EXPECTED_HOME || r.marketplace !== "personal") throw new Error(JSON.stringify({result:r,expectedSource:process.env.EXPECTED_SOURCE,expectedHome:process.env.EXPECTED_HOME}))'
```
