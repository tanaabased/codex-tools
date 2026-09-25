# Native Codex installation

Real-Codex journeys against the CLI on `PATH`. The packed-plugin case uses `CODEX_TOOLS_PACKAGE`
when supplied by CI, otherwise packs the prepared build into its disposable root.

## Testing

```bash
# should plan, install, repeat, and select a marketplace with real Codex
source ../.fixtures/native.sh
cli install "$source" --dry-run --json >"$root/preview.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.status, "planned"); assert.equal(r.native.length, 0)' "$root/preview.json"
test ! -e "$root/codex"
cli install "$source" --json >"$root/install.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.inspection.installed, true); assert.equal(r.inspection.enabled, true); assert.equal(r.inspection.authentication, "unknown"); assert.equal(r.inspection.activation, "unknown")' "$root/install.json"
cache="$root/codex/plugins/cache/personal/codex-tools-smoke/1.0.0"
catalog="$root/home/.agents/plugins/marketplace.json"
cmp "$source/skills/probe/SKILL.md" "$cache/skills/probe/SKILL.md"
bun -e 'import fs from "node:fs"; process.stdout.write(JSON.stringify([fs.statSync(process.argv[1]).mtimeMs, fs.statSync(process.argv[2]).ino]))' "$catalog" "$cache/.codex-plugin/plugin.json" >"$root/before.json"
cli install "$source" --json >"$root/repeat.json"
bun -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.inspection.installed, true); assert.equal(r.completed.find(s => s.operation === "install")?.skipped, true); assert.deepEqual([fs.statSync(process.argv[2]).mtimeMs, fs.statSync(process.argv[3]).ino], await Bun.file(process.argv[4]).json())' "$root/repeat.json" "$catalog" "$cache/.codex-plugin/plugin.json" "$root/before.json"
mkdir "$root/selected marketplace"
cli install "$source" --marketplace selected --marketplace-path "$root/selected marketplace/.agents/plugins/marketplace.json" --json >"$root/selected.json"
cli install "$source" --marketplace selected --json >"$root/selected-repeat.json"
bun -e 'import assert from "node:assert/strict"; const first = await Bun.file(process.argv[1]).json(), repeat = await Bun.file(process.argv[2]).json(); assert.equal(first.inspection.installed, true); assert.ok(first.completed.some(s => s.operation === "register-marketplace")); assert.equal(repeat.inspection.installed, true); assert.ok(!repeat.plan.some(s => s.operation === "register-marketplace"))' "$root/selected.json" "$root/selected-repeat.json"

# should refresh successive and stale local versions while preserving other marketplaces
source ../.fixtures/native.sh
cli install "$source" --json >"$root/install.json"
mkdir "$root/selected"
cli install "$source" --marketplace selected --marketplace-path "$root/selected/.agents/plugins/marketplace.json" --json >"$root/selected.json"
cp "$root/codex/config.toml" "$root/config-before"
cp "$root/home/.agents/plugins/marketplace.json" "$root/catalog-before"
cp "$source/.codex-plugin/plugin.json" "$root/manifest-before"
cp "$root/codex/plugins/cache/selected/codex-tools-smoke/1.0.0/skills/probe/SKILL.md" "$root/selected-before"
cli refresh "$source" --dry-run --json >"$root/preview.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.manifestEdit.applied, false); assert.equal(r.native.length, 0)' "$root/preview.json"
cmp "$source/.codex-plugin/plugin.json" "$root/manifest-before"
for payload in 'second native payload' 'third native payload'; do
  printf '%s' "$payload" >"$source/skills/probe/SKILL.md"
  cli refresh "$source" --json >"$root/refresh.json"
  bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.status, "refreshed"); assert.equal(r.inspection.payload, "verified"); assert.equal(r.inspection.activation, "unknown"); assert.match(r.manifestEdit.after, /^1\.0\.0\+codex\.\d{14}$/); assert.equal(await Bun.file(r.cachePath + "/skills/probe/SKILL.md").text(), process.argv[2])' "$root/refresh.json" "$payload"
done
cmp "$root/codex/config.toml" "$root/config-before"
cmp "$root/home/.agents/plugins/marketplace.json" "$root/catalog-before"
cmp "$root/codex/plugins/cache/selected/codex-tools-smoke/1.0.0/skills/probe/SKILL.md" "$root/selected-before"
bun -e 'const file = process.argv[1], m = await Bun.file(file).json(); m.version = "2.0.0-beta.1+local"; await Bun.write(file, JSON.stringify(m))' "$source/.codex-plugin/plugin.json"
cli refresh "$source" --marketplace selected --json >"$root/stale.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.match(r.manifestEdit.after, /^2\.0\.0-beta\.1\+codex\.\d{14}$/)' "$root/stale.json"

# should reject changed mappings and report a native write failure before recovering
source ../.fixtures/native.sh
cli install "$source" --json >"$root/install.json"
mapping="$root/home/plugins/codex-tools-smoke"
rm "$mapping"
ln -s "$root/home" "$mapping"
set +e
cli refresh "$source" --json >"$root/mismatch.json"
status=$?
set -e
test "$status" -eq 2
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.match(r.error, /source mapping/)' "$root/mismatch.json"
rm "$mapping"
ln -s "$source" "$mapping"
chmod 555 "$root/codex/plugins/cache/personal/codex-tools-smoke"
set +e
cli refresh "$source" --json >"$root/failure.json"
status=$?
set -e
test "$status" -ne 0
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.status, "incomplete"); assert.equal(r.manifestEdit.applied, true); assert.equal(r.effects.reinstallAttempted, true); assert.ok(r.nativeError.exitCode > 0); assert.equal((await Bun.file(process.argv[2]).json()).version, r.manifestEdit.after)' "$root/failure.json" "$source/.codex-plugin/plugin.json"
chmod 755 "$root/codex/plugins/cache/personal/codex-tools-smoke"
cli refresh "$source" --json >"$root/recovered.json"
bun -e 'import assert from "node:assert/strict"; assert.equal((await Bun.file(process.argv[1]).json()).ok, true)' "$root/recovered.json"

# should preserve post-bootstrap links and one native marketplace through external and self-installation
source ../.fixtures/native.sh
mkdir "$root/linked"
bun ../.fixtures/symlink.js setup "$root/linked"
native_env=("PATH=$PATH" "HOME=$root/linked/home" "CODEX_HOME=$root/linked/home/.codex" "TMPDIR=$root" "NO_COLOR=1")
cp "$root/linked/source/dotfiles/catalog.json" "$root/catalog-before"
for plugin in external source; do
  cli install "$root/linked/$plugin" --dry-run --json >"$root/preview.json"
  bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.ok, true); assert.equal(r.native.length, 0)' "$root/preview.json"
done
cmp "$root/linked/source/dotfiles/catalog.json" "$root/catalog-before"
for plugin in external source; do
  cli install "$root/linked/$plugin" --json >"$root/install.json"
  bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.inspection.installed, true); assert.ok(!r.completed.some(s => s.operation === "register-marketplace")); process.stdout.write(r.source.name + ": " + r.completed.map(s => s.operation).join(", ") + "\n")' "$root/install.json"
  cli install "$root/linked/$plugin" --json >"$root/repeat.json"
  bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.completed.find(s => s.operation === "install")?.skipped, true)' "$root/repeat.json"
done
native codex plugin marketplace list --json >"$root/marketplaces.json"
bun -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.marketplaces.length, 1); assert.equal(r.marketplaces[0].name, "linked-market"); assert.equal(fs.realpathSync(r.marketplaces[0].root), process.argv[2])' "$root/marketplaces.json" "$root/linked/home"
bun ../.fixtures/symlink.js preserved "$root/linked"
cmp "$root/linked/source/payload.txt" "$root/linked/state/plugins/cache/linked-market/fixture-self/1.0.0/payload.txt"
cmp "$root/linked/external/payload.txt" "$root/linked/state/plugins/cache/linked-market/fixture-external/1.0.0/payload.txt"

# should discover packed plugin skills in a fresh Codex session and execute their cached runtime
source ../.fixtures/native.sh
archive=${CODEX_TOOLS_PACKAGE:-}
if test -z "$archive"; then
  (cd ../.. && npm pack --ignore-scripts --pack-destination "$root") >"$root/pack.log"
  archive=$(find "$root" -maxdepth 1 -name '*.tgz' -print -quit)
fi
test -n "$archive"
mkdir "$root/packed"
tar -xzf "$archive" -C "$root/packed"
package="$root/packed/package"
cli install "$package" --json >"$root/install.json"
bun -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const r = await Bun.file(process.argv[1]).json(), p = await Bun.file(process.argv[2] + "/.codex-plugin/plugin.json").json(); assert.equal(p.name, "codex-tools"); assert.equal(r.inspection.installed, true); assert.equal(r.inspection.enabled, true); const cache = process.argv[3] + "/plugins/cache/personal/" + p.name + "/" + p.version; assert.equal(fs.realpathSync(cache), cache); for (const skill of ["setup", "maintenance"]) assert.ok((await Bun.file(cache + "/skills/codex-tools-" + skill + "/SKILL.md").text()).includes("name: tanaab-codex-tools-" + skill)); process.stdout.write(cache)' "$root/install.json" "$package" "$root/codex" >"$root/cache-path"
native bun -e 'const { freshSkills } = await import(process.argv[1]); await freshSkills(process.env, process.cwd(), ["codex-tools:tanaab-codex-tools-setup", "codex-tools:tanaab-codex-tools-maintenance"])' "$PWD/../../dev/lib/fresh-skills.ts"
cached=$(cat "$root/cache-path")
printf '%s\n' '{"version":"1.0.0","codexTools":{"managedPaths":[".codex-plugin","skills"]}}' >"$source/package.json"
native "$cached/dist/codex-tools" install "$source" --dry-run --json >"$root/setup.json"
native "$cached/dist/codex-tools" cache sync --repo-root "$source" --cache-path "$root/target" --missing-target create --dry-run --json >"$root/maintenance.json"
bun -e 'import assert from "node:assert/strict"; for (const file of process.argv.slice(1)) assert.equal((await Bun.file(file).json()).status, "planned")' "$root/setup.json" "$root/maintenance.json"
test ! -e "$root/target"
```
