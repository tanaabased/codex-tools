# Symlinked marketplaces

Exercise linked Codex homes, marketplace parents, catalogs, and plugin mappings through the built
CLI. The repository owns its catalog outside `managedPaths`; no Stow ownership is assumed.
Fake children prove orchestration, not native Codex compatibility—that remains the native probe's job.
Links should survive installation. Apparently that needs saying.

## Testing

```bash
# should plan external and repository self-installs without changing linked state or spawning children
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
bun fixture.js setup "$root"
cp "$root/source/dotfiles/catalog.json" "$root/catalog-before.json"
export PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/home/.codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
for source in external source; do
  codex-tools install "$root/$source" --dry-run --json >"$root/result.json" || { status=$?; cat "$root/result.json" >&2; exit "$status"; }
  bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "planned" || r.native.length || r.completed.length) throw new Error(JSON.stringify(r))' "$root/result.json"
done
bun fixture.js preserved "$root"
cmp "$root/catalog-before.json" "$root/source/dotfiles/catalog.json"
test ! -e "$root/children.log"
test ! -e "$root/state/.fake-codex-state.json"
test ! -e "$root/state/plugins/cache"
test ! -e "$root/home/plugins/fixture-external"

# should preserve linked state and policy through external install, self-install, and repeat install
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
bun fixture.js setup "$root"
export PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/home/.codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
for source in external source; do
  codex-tools install "$root/$source" --json >"$root/result.json" || { status=$?; cat "$root/result.json" >&2; exit "$status"; }
  bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "installed" || !r.inspection.installed || r.completed.some(s => s.operation === "register-marketplace")) throw new Error(JSON.stringify(r)); process.stdout.write(r.source.name + ": " + r.completed.map(s => s.operation).join(", ") + "\n")' "$root/result.json"
  codex-tools install "$root/$source" --json >"$root/repeated.json" || { status=$?; cat "$root/repeated.json" >&2; exit "$status"; }
  bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || !r.completed.find(s => s.operation === "install")?.skipped) throw new Error(JSON.stringify(r))' "$root/repeated.json"
done
bun fixture.js preserved "$root"
cmp "$root/external/payload.txt" "$root/state/plugins/cache/linked-market/fixture-external/1.0.0/payload.txt"
cmp "$root/source/payload.txt" "$root/state/plugins/cache/linked-market/fixture-self/1.0.0/payload.txt"
bun -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const root = process.argv[1]; assert.equal(fs.realpathSync(root + "/home/plugins/fixture-external"), root + "/external"); const catalog = JSON.parse(fs.readFileSync(root + "/source/dotfiles/catalog.json")); assert.deepEqual(catalog.plugins.map(p => p.name).sort(), ["fixture-external", "fixture-self"]); const rows = fs.readFileSync(root + "/children.log", "utf8").trim().split("\n").map(JSON.parse); assert.equal(rows.filter(r => r.argv[0] === "plugin" && r.argv[1] === "add").length, 2)' "$root"

# should reject a dangling catalog before changing state or spawning children
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
bun fixture.js setup "$root"
mv "$root/source/dotfiles/catalog.json" "$root/catalog-before.json"
export PATH="$PWD/../fixtures/bin:$PATH" HOME="$root/home" CODEX_HOME="$root/home/.codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
set +e
codex-tools install "$root/external" --json >"$root/result.json" 2>"$root/error"
status=$?
set -e
test "$status" -ne 0
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (r.ok || !/dangling|missing|resolve/i.test(JSON.stringify(r))) throw new Error(JSON.stringify(r))' "$root/result.json"
test -L "$root/home/.agents/plugins/marketplace.json"
test ! -e "$root/source/dotfiles/catalog.json"
test ! -e "$root/children.log"
test ! -e "$root/state/.fake-codex-state.json"
test ! -e "$root/state/plugins/cache"
test ! -e "$root/home/plugins/fixture-external"
mv "$root/catalog-before.json" "$root/source/dotfiles/catalog.json"
bun fixture.js preserved "$root"
```
