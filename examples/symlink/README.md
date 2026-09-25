# Symlinked marketplaces

Check planning and invalid-link rejection against linked home and marketplace paths.
Real installation and preservation run in the `native` example.

## Testing

```bash
# should plan repository self-installation without changing links or starting Codex
source environment.sh
mkdir "$root/linked"
bun symlink.js setup "$root/linked"
export PATH="$PWD/bin:$PATH" HOME="$root/linked/home" CODEX_HOME="$root/linked/home/.codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
cp "$root/linked/source/dotfiles/catalog.json" "$root/catalog-before.json"
codex-tools install "$root/linked/source" --dry-run | grep -F 'status: planned'
codex-tools install "$root/linked/external" --dry-run | grep -F 'status: planned'
bun symlink.js preserved "$root/linked"
cmp "$root/catalog-before.json" "$root/linked/source/dotfiles/catalog.json"
test ! -e "$root/children.log"
test ! -e "$root/linked/state/plugins/cache"

# should reject a dangling catalog before changing state or starting Codex
source environment.sh
mkdir "$root/linked"
bun symlink.js setup "$root/linked"
export PATH="$PWD/bin:$PATH" HOME="$root/linked/home" CODEX_HOME="$root/linked/home/.codex" CODEX_TOOLS_FIXTURE_LOG="$root/children.log"
mv "$root/linked/source/dotfiles/catalog.json" "$root/catalog-before.json"
status=0
codex-tools install "$root/linked/external" >"$root/result.txt" 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F 'Dangling installation path' "$root/error"
test -L "$HOME/.agents/plugins/marketplace.json"
test ! -e "$root/linked/source/dotfiles/catalog.json"
test ! -e "$root/children.log"
test ! -e "$root/linked/state/plugins/cache"
```
