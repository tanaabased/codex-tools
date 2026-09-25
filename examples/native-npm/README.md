# Native npm acquisition

Real Codex and npm acquire plugins from a disposable loopback HTTPS registry. No package is
published. `setup.sh` owns registry readiness and cleanup; assertions remain here.

## Testing

```bash
# should leave npm resolution pending during a dry run
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.2.3' --dry-run | grep -F 'package version: pending'
test ! -e "$HOME/.agents/plugins/marketplace.json"
test ! -e "$CODEX_HOME"

# should acquire an exact release without running package lifecycle scripts
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.2.3' | grep -F 'package version: 1.2.3'
codex plugin list --json | grep -F 'native-npm-probe'
test ! -e "$root/LIFECYCLE-RAN"

# should retain the catalog on repeat installation
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.2.3'
cp "$HOME/.agents/plugins/marketplace.json" "$root/catalog-before"
codex-tools install 'npm:@fixture/package-name@1.2.3' | grep -F 'unchanged: install'
cmp "$root/catalog-before" "$HOME/.agents/plugins/marketplace.json"

# should resolve tags and ranges to an exact release
source setup.sh
codex-tools install 'npm:@fixture/package-name@stable' | grep -F 'package version: 1.2.3'
codex-tools install 'npm:@fixture/package-name@~1.2.0' | grep -F 'package version: 1.2.3'

# should retain the release and registry pin when defaults change
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.2.3'
printf '1.3.0' >"$root/latest"
env 'npm_config_@fixture:registry=https://127.0.0.1:1' codex-tools refresh 'npm:@fixture/package-name' | grep -F 'package version: 1.2.3'
codex-tools install 'npm:@fixture/package-name@latest' | grep -F 'package version: 1.3.0'
test ! -e "$root/LIFECYCLE-RAN"

# should refresh an npm plugin in an explicitly selected marketplace
source setup.sh
mkdir "$root/selected"
codex-tools install 'npm:@fixture/package-name@1.2.3' --marketplace selected --marketplace-path "$root/selected/.agents/plugins/marketplace.json"
codex-tools refresh 'npm:@fixture/package-name' --marketplace selected | grep -F 'package version: 1.2.3'

# should discover a portable plugin's skill in a fresh session
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.3.1' | grep -F 'package version: 1.3.1'
bun fresh-skills.ts "$HOME" native-npm-probe:native-npm-fixture
test ! -e "$root/LIFECYCLE-RAN"

# should reject incomplete packages and malformed selectors without changing the catalog
source setup.sh
codex-tools install 'npm:@fixture/package-name@1.3.1'
cp "$HOME/.agents/plugins/marketplace.json" "$root/catalog-before"
for selector in '2.0.0' 'file:../bad'; do
  status=0
  codex-tools install "npm:@fixture/package-name@$selector" || status=$?
  test "$status" -ne 0
  cmp "$root/catalog-before" "$HOME/.agents/plugins/marketplace.json"
done
bun fresh-skills.ts "$HOME" native-npm-probe:native-npm-fixture
test ! -e "$root/LIFECYCLE-RAN"
```
