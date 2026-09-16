# Plugin installation

Exercise local and npm installation through deterministic child commands. These fixtures prove
Codex Tools orchestration; the isolated native-verification workflow owns real Codex/npm behavior.

## Testing

```bash
# should plan a local install without spawning codex or writing state
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
cp -R source "$root/source"
output=$(PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log" codex-tools install "$root/source" --dry-run --json)
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (!r.ok || r.status !== "planned" || r.native.length) process.exit(1)'
test ! -e "$root/children.log"
test ! -e "$root/codex"
test ! -e "$root/home/.agents"

# should install a local plugin and pass the selected environment to codex
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
cp -R source "$root/source"
PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=local-install CODEX_TOOLS_FIXTURE_LOG="$root/children.log" codex-tools install "$root/source" --json >"$root/result.json"
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "installed" || !r.inspection.installed || r.source.name !== "fixture-local") process.exit(1)' "$root/result.json"
cmp "$root/source/payload.txt" "$root/codex/plugins/cache/personal/fixture-local/1.0.0/payload.txt"
EXPECTED_HOME="$root/home" EXPECTED_CODEX_HOME="$root/codex" bun -e 'const rows = (await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse); if (!rows.length || rows.some((r) => r.command !== "codex" || r.sentinel !== "local-install" || r.home !== process.env.EXPECTED_HOME || r.codexHome !== process.env.EXPECTED_CODEX_HOME)) process.exit(1)' "$root/children.log"

# should install an exact npm release without using a public registry
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=npm-install CODEX_TOOLS_FIXTURE_LOG="$root/children.log" codex-tools install 'npm:@fixture/example@^1.0.0' --json >"$root/result.json"
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "installed" || r.source.type !== "npm" || r.source.version !== "1.2.3" || r.source.name !== "fixture-plugin" || r.inspection.payload !== "verified") process.exit(1)' "$root/result.json"
EXPECTED_HOME="$root/home" EXPECTED_CODEX_HOME="$root/codex" bun -e 'const rows = (await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse); const npm = rows.filter((r) => r.command === "npm"); if (!npm.length || npm.some((r) => r.home !== process.env.EXPECTED_HOME || r.codexHome !== process.env.EXPECTED_CODEX_HOME) || !rows.some((r) => r.command === "codex" && r.codexHome !== process.env.EXPECTED_CODEX_HOME) || !rows.some((r) => r.command === "codex" && r.codexHome === process.env.EXPECTED_CODEX_HOME) || rows.some((r) => r.sentinel !== "npm-install")) process.exit(1)' "$root/children.log"

# should preserve a native child exit code without writing a catalog
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
cp -R source "$root/source"
set +e
PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/codex" FAKE_CODEX_EXIT=37 codex-tools install "$root/source" --json >"$root/result.json" 2>"$root/error"
status=$?
set -e
test "$status" -eq 37
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (r.ok || r.status !== "incomplete" || r.nativeError.exitCode !== 37 || !r.nativeError.stderr.includes("synthetic native failure")) process.exit(1)' "$root/result.json"
test ! -s "$root/error"
test ! -e "$root/home/.agents/plugins/marketplace.json"
```
