# Native npm acquisition

Real Codex and npm use a disposable loopback HTTPS registry. No public package is published.

## Testing

```bash
# should acquire exact, tag, and range selectors with native Codex and preserve repeat installs
source ../.fixtures/native.sh
start_registry
cli install 'npm:@fixture/package-name@1.2.3' --dry-run --json >"$root/preview.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.source.valid, null)' "$root/preview.json"
test ! -e "$root/home/.agents/plugins/marketplace.json"
mkdir -p "$root/native-home/.agents/plugins" "$root/native-codex"
bun -e 'await Bun.write(process.argv[1], JSON.stringify({name: "compat", plugins: [{name: "native-npm-probe", source: {source: "npm", package: "@fixture/package-name", version: "1.2.3", registry: process.argv[2]}}]}))' "$root/native-home/.agents/plugins/marketplace.json" "$registry"
(cd "$root/native-home" && env -i "${native_env[@]}" HOME="$root/native-home" CODEX_HOME="$root/native-codex" codex plugin add native-npm-probe@compat --json) >"$root/native.json"
bun -e 'import assert from "node:assert/strict"; assert.equal((await Bun.file(process.argv[1]).json()).name, "native-npm-probe")' "$root/native.json"
cli install 'npm:@fixture/package-name@1.2.3' --json >"$root/install.json"
bun -e 'import assert from "node:assert/strict"; assert.equal((await Bun.file(process.argv[1]).json()).inspection.payload, "verified")' "$root/install.json"
catalog="$root/home/.agents/plugins/marketplace.json"
bun -e 'import fs from "node:fs"; process.stdout.write(String(fs.statSync(process.argv[1]).mtimeMs))' "$catalog" >"$root/mtime"
cli install 'npm:@fixture/package-name@1.2.3' --json >"$root/repeat.json"
bun -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.completed.find(s => s.operation === "install")?.skipped, true); assert.equal(String(fs.statSync(process.argv[2]).mtimeMs), await Bun.file(process.argv[3]).text())' "$root/repeat.json" "$catalog" "$root/mtime"
for selector in stable '~1.2.0'; do
  cli install "npm:@fixture/package-name@$selector" --json >"$root/selector.json"
  bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.ok, true); assert.equal(r.source.version, "1.2.3")' "$root/selector.json"
done
test ! -e "$root/LIFECYCLE-RAN"

# should retain pinned releases and registries on refresh and accept updated and portable plugins
source ../.fixtures/native.sh
start_registry
cli install 'npm:@fixture/package-name@1.2.3' --json >"$root/install.json"
printf '%s' '1.3.0' >"$root/latest"
native env 'npm_config_@fixture:registry=https://127.0.0.1:1' codex-tools refresh 'npm:@fixture/package-name' --json >"$root/pinned.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.source.version, "1.2.3"); assert.equal(r.status, "refreshed")' "$root/pinned.json"
cli install 'npm:@fixture/package-name@latest' --json >"$root/latest.json"
bun -e 'import assert from "node:assert/strict"; assert.equal((await Bun.file(process.argv[1]).json()).source.version, "1.3.0")' "$root/latest.json"
cli install 'npm:@fixture/package-name@1.3.1' --json >"$root/portable.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.ok, true); assert.equal(r.source.version, "1.3.1")' "$root/portable.json"
mkdir "$root/selected"
cli install 'npm:@fixture/package-name@1.2.3' --marketplace selected --marketplace-path "$root/selected/.agents/plugins/marketplace.json" --json >"$root/selected.json"
cli refresh 'npm:@fixture/package-name' --marketplace selected --json >"$root/refresh.json"
bun -e 'import assert from "node:assert/strict"; const r = await Bun.file(process.argv[1]).json(); assert.equal(r.ok, true); assert.equal(r.source.version, "1.2.3")' "$root/refresh.json"
test ! -e "$root/LIFECYCLE-RAN"

# should reject incomplete and malformed packages without disturbing catalog or fresh-session skills
source ../.fixtures/native.sh
start_registry
cli install 'npm:@fixture/package-name@1.3.1' --json >"$root/install.json"
catalog="$root/home/.agents/plugins/marketplace.json"
bun -e 'const file = process.argv[1], c = await Bun.file(file).json(); c.plugins.push({name: "unrelated", source: {source: "npm", package: "@fixture/missing", version: "1.0.0", registry: process.argv[2]}, note: "preserve"}); await Bun.write(file, JSON.stringify(c))' "$catalog" "$registry"
cp "$catalog" "$root/before.json"
for selector in '2.0.0' 'file:../bad'; do
  set +e
  cli install "npm:@fixture/package-name@$selector" --json >"$root/rejected.json"
  status=$?
  set -e
  test "$status" -ne 0
  bun -e 'import assert from "node:assert/strict"; assert.equal((await Bun.file(process.argv[1]).json()).ok, false)' "$root/rejected.json"
  cmp "$catalog" "$root/before.json"
done
test ! -e "$root/LIFECYCLE-RAN"
native bun -e 'const { freshSkills } = await import(process.argv[1]); await freshSkills(process.env, process.cwd(), ["native-npm-probe:native-npm-fixture"])' "$PWD/../../dev/lib/fresh-skills.ts"
```
