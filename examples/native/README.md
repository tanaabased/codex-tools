# Native Codex installation

Install and refresh real plugins with the packed Codex Tools CLI and supported Codex on `PATH`.
Each case copies a sample plugin into a disposable home; CI supplies `CODEX_TOOLS_PACKAGE`.

## Testing

```bash
# should preview installation without creating Codex state
source ../.fixtures/native.sh
codex-tools install "$plugin" --dry-run | grep -F 'status: planned'
test ! -e "$CODEX_HOME"
test ! -e "$HOME/.agents"

# should acquire a local plugin through real Codex
source ../.fixtures/native.sh
codex-tools install "$plugin" | grep -F 'status: installed'
codex plugin list --json | grep -F 'codex-tools-smoke'
cmp "$plugin/skills/probe/SKILL.md" "$CODEX_HOME/plugins/cache/personal/codex-tools-smoke/1.0.0/skills/probe/SKILL.md"

# should leave a repeated installation unchanged
source ../.fixtures/native.sh
codex-tools install "$plugin"
cp "$HOME/.agents/plugins/marketplace.json" "$root/catalog-before"
codex-tools install "$plugin" | grep -F 'unchanged: install'
cmp "$root/catalog-before" "$HOME/.agents/plugins/marketplace.json"

# should register and reuse an explicitly selected marketplace
source ../.fixtures/native.sh
mkdir "$root/selected marketplace"
codex-tools install "$plugin" --marketplace selected --marketplace-path "$root/selected marketplace/.agents/plugins/marketplace.json" | grep -F 'completed: register-marketplace'
codex-tools install "$plugin" --marketplace selected | grep -F 'unchanged: install'
cmp "$plugin/skills/probe/SKILL.md" "$CODEX_HOME/plugins/cache/selected/codex-tools-smoke/1.0.0/skills/probe/SKILL.md"

# should preview refresh without editing the source manifest
source ../.fixtures/native.sh
codex-tools install "$plugin"
cp "$plugin/.codex-plugin/plugin.json" "$root/manifest-before"
codex-tools refresh "$plugin" --dry-run | grep -F 'status: planned'
cmp "$root/manifest-before" "$plugin/.codex-plugin/plugin.json"

# should acquire successive changed payloads with fresh cachebuster versions
source ../.fixtures/native.sh
codex-tools install "$plugin"
for payload in second third; do
  printf '\n%s payload\n' "$payload" >>"$plugin/skills/probe/SKILL.md"
  codex-tools refresh "$plugin" | grep -F 'payload: verified'
  version=$(bun -p 'require(process.argv[1]).version' "$plugin/.codex-plugin/plugin.json")
  cmp "$plugin/skills/probe/SKILL.md" "$CODEX_HOME/plugins/cache/personal/codex-tools-smoke/$version/skills/probe/SKILL.md"
done

# should preserve another marketplace when refreshing a stale local release
source ../.fixtures/native.sh
codex-tools install "$plugin"
mkdir "$root/selected"
codex-tools install "$plugin" --marketplace selected --marketplace-path "$root/selected/.agents/plugins/marketplace.json"
cp "$CODEX_HOME/config.toml" "$root/config-before"
cp "$HOME/.agents/plugins/marketplace.json" "$root/catalog-before"
bun -e 'const file = process.argv[1], p = await Bun.file(file).json(); p.version = "2.0.0-beta.1+local"; await Bun.write(file, JSON.stringify(p))' "$plugin/.codex-plugin/plugin.json"
codex-tools refresh "$plugin" --marketplace selected | grep -F 'manifest: 2.0.0-beta.1+local -> 2.0.0-beta.1+codex.'
cmp "$root/config-before" "$CODEX_HOME/config.toml"
cmp "$root/catalog-before" "$HOME/.agents/plugins/marketplace.json"
cmp "$plugin/skills/probe/SKILL.md" "$CODEX_HOME/plugins/cache/personal/codex-tools-smoke/1.0.0/skills/probe/SKILL.md"

# should reject a changed source mapping before editing the manifest
source ../.fixtures/native.sh
codex-tools install "$plugin"
cp "$plugin/.codex-plugin/plugin.json" "$root/manifest-before"
rm "$HOME/plugins/codex-tools-smoke"
ln -s "$HOME" "$HOME/plugins/codex-tools-smoke"
status=0
codex-tools refresh "$plugin" 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F 'source mapping' "$root/error"
cmp "$root/manifest-before" "$plugin/.codex-plugin/plugin.json"

# should report partial effects from a native write failure and recover
source ../.fixtures/native.sh
codex-tools install "$plugin"
chmod 555 "$CODEX_HOME/plugins/cache/personal/codex-tools-smoke"
status=0
codex-tools refresh "$plugin" >"$root/failure.txt" || status=$?
test "$status" -ne 0
grep -F 'status: incomplete' "$root/failure.txt"
grep -F '(applied)' "$root/failure.txt"
grep -F 'reinstall attempted: true' "$root/failure.txt"
chmod 755 "$CODEX_HOME/plugins/cache/personal/codex-tools-smoke"
codex-tools refresh "$plugin" | grep -F 'payload: verified'

# should preserve linked paths through external installation and repository self-installation
source ../.fixtures/environment.sh
mkdir "$root/linked"
bun ../.fixtures/symlink.js setup "$root/linked"
export HOME="$root/linked/home" CODEX_HOME="$root/linked/home/.codex"
for plugin in external source; do
  codex-tools install "$root/linked/$plugin" | grep -F 'status: installed'
  codex-tools install "$root/linked/$plugin" | grep -F 'unchanged: install'
done
codex plugin marketplace list --json | bun -e 'import assert from "node:assert/strict"; assert.deepEqual((await Bun.stdin.json()).marketplaces.map(m => m.name), ["linked-market"])'
bun ../.fixtures/symlink.js preserved "$root/linked"
cmp "$root/linked/source/payload.txt" "$root/linked/state/plugins/cache/linked-market/fixture-self/1.0.0/payload.txt"
cmp "$root/linked/external/payload.txt" "$root/linked/state/plugins/cache/linked-market/fixture-external/1.0.0/payload.txt"

# should discover packed skills in a fresh session and execute their cached runtime
source ../.fixtures/native.sh
tar -xzf "$CODEX_TOOLS_PACKAGE" -C "$root"
codex-tools install "$root/package" | grep -F 'status: installed'
bun ../.fixtures/fresh-skills.ts "$HOME" codex-tools:tanaab-codex-tools-setup codex-tools:tanaab-codex-tools-maintenance
version=$(bun -p 'require(process.argv[1]).version' "$root/package/package.json")
cached="$CODEX_HOME/plugins/cache/personal/codex-tools/$version"
"$cached/dist/codex-tools" install "$plugin" --dry-run | grep -F 'status: planned'
"$cached/dist/codex-tools" cache sync --repo-root "$plugin" --cache-path "$root/target" --missing-target create --dry-run | grep -F 'status: planned'
test ! -e "$root/target"
```
