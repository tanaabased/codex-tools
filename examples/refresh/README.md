# Plugin refresh

Exercise local cachebuster refresh and npm's pinned-release refresh through deterministic child
commands. Real native compatibility remains the isolated native-verification workflow's concern.

## Testing

```bash
# should refresh a local payload through a new cachebuster version
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
cp -R source "$root/source"
common_path="$PWD/../fixtures/bin:$PATH"
PATH="$common_path" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=local-refresh CODEX_TOOLS_FIXTURE_LOG="$root/children.log" codex-tools install "$root/source" --json >"$root/install.json" || { status=$?; cat "$root/install.json" >&2; exit "$status"; }
printf 'refreshed payload\n' >"$root/source/payload.txt"
PATH="$common_path" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=local-refresh CODEX_TOOLS_FIXTURE_LOG="$root/children.log" codex-tools refresh "$root/source" --json >"$root/refresh.json" || { status=$?; cat "$root/refresh.json" >&2; exit "$status"; }
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "refreshed" || r.manifestEdit.before !== "1.0.0" || !/^1[.]0[.]0[+]codex[.][0-9]{14}$/.test(r.manifestEdit.after) || r.inspection.payload !== "verified") throw new Error(JSON.stringify(r))' "$root/refresh.json"
cache=$(bun -e 'const r = await Bun.file(process.argv[1]).json(); process.stdout.write(r.cachePath)' "$root/refresh.json")
cmp "$root/source/payload.txt" "$cache/payload.txt"
EXPECTED_HOME="$root/home" EXPECTED_CODEX_HOME="$root/codex" bun -e 'const rows = (await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse); const invalid = rows.filter((r) => r.sentinel !== "local-refresh" || r.home !== process.env.EXPECTED_HOME || r.codexHome !== process.env.EXPECTED_CODEX_HOME); if (!rows.length || invalid.length) throw new Error(JSON.stringify({invalid,expectedHome:process.env.EXPECTED_HOME,expectedCodexHome:process.env.EXPECTED_CODEX_HOME}))' "$root/children.log"

# should retain the installed npm release when registry selection moves
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
mkdir "$root/home"
common_path="$PWD/../fixtures/bin:$PATH"
PATH="$common_path" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=npm-refresh CODEX_TOOLS_FIXTURE_LOG="$root/install.log" codex-tools install npm:@fixture/example@1.2.3 --json >"$root/install.json" || { status=$?; cat "$root/install.json" >&2; exit "$status"; }
PATH="$common_path" HOME="$root/home" CODEX_HOME="$root/codex" CODEX_TOOLS_CHILD_SENTINEL=npm-refresh CODEX_TOOLS_FIXTURE_LOG="$root/refresh.log" FAKE_NPM_RELEASE=9.9.9 codex-tools refresh npm:@fixture/example --json >"$root/refresh.json" || { status=$?; cat "$root/refresh.json" >&2; exit "$status"; }
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "refreshed" || r.source.version !== "1.2.3" || r.source.pluginVersion !== "1.2.3") throw new Error(JSON.stringify(r))' "$root/refresh.json"
bun -e 'const rows = (await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse); if (rows.some((r) => r.command === "npm" && r.argv[0] === "view") || rows.some((r) => r.sentinel !== "npm-refresh")) throw new Error(JSON.stringify(rows))' "$root/refresh.log"
```
