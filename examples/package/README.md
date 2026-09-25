# Packed consumers

Exercise the exact prepared npm tarball under Node, without checkout dependencies or Bun on the
consumer's PATH. CI supplies `CODEX_TOOLS_PACKAGE`; `bun run check:package` prepares it locally.

## Setup

```bash
# should install the prepared package in a disposable consumer
mkdir -p "$TMPDIR/consumer" "$TMPDIR/home" "$TMPDIR/node-bin" "$TMPDIR/bun-bin"
cp -R consumer/. "$TMPDIR/consumer"
ln -s "$(command -v node)" "$TMPDIR/node-bin/node"
ln -s "$(command -v bun)" "$TMPDIR/bun-bin/bun"
typescript=$(bun -p 'require("../../package.json").devDependencies.typescript.replace(/^[~^]/, "")')
npm_config_cache="$TMPDIR/npm-cache" npm install --prefix "$TMPDIR/consumer" --ignore-scripts --no-audit --no-fund "$CODEX_TOOLS_PACKAGE" "typescript@$typescript"
```

## Testing

```bash
# should contain only the supported payload and usable documentation
npm_config_cache="$TMPDIR/npm-cache" npm pack "$CODEX_TOOLS_PACKAGE" --dry-run --offline --ignore-scripts --json >"$TMPDIR/inventory.json"
bun check.ts "$CODEX_TOOLS_PACKAGE" "$TMPDIR/inventory.json" "$TMPDIR/consumer"

# should run the installed executable with only Node available
source environment.sh
expected=$(bun -p 'require(process.argv[1]).version' "$installed/package.json")
PATH="$TMPDIR/node-bin" "$executable" --help | grep -F 'Usage:'
test "$(PATH="$TMPDIR/node-bin" "$executable" --version)" = "$expected"
PATH="$TMPDIR/node-bin" "$executable" install 'npm:@fixture/plugin@^1.0.0' --dry-run | grep -F 'status: planned'
test ! -e "$CODEX_HOME"

# should expose ESM and CommonJS APIs without checkout dependencies
source environment.sh
PATH="$TMPDIR/node-bin" node consumer.mjs
PATH="$TMPDIR/node-bin" node consumer.cjs
PATH="$TMPDIR/node-bin" node documented.cjs | grep -Fx 'planned'

# should resolve ESM and CommonJS declarations through both Node resolution modes
source environment.sh
PATH="$TMPDIR/node-bin" node node_modules/typescript/bin/tsc --module Node16 --moduleResolution Node16
PATH="$TMPDIR/node-bin" node node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext

# should preserve unmanaged files through the installed library
source environment.sh
PATH="$TMPDIR/node-bin" node safety.mjs "$TMPDIR/library-safety"

# should execute the bundled skills' runtime without creating state during preview
source environment.sh
PATH="$TMPDIR/node-bin" "$installed/skills/codex-tools-setup/../../dist/codex-tools" install source --dry-run | grep -F 'status: planned'
PATH="$TMPDIR/node-bin" "$installed/skills/codex-tools-maintenance/../../dist/codex-tools" cache sync --repo-root source --cache-path "$TMPDIR/cache" --missing-target create --dry-run | grep -F 'status: planned'
test ! -e "$TMPDIR/cache"

# should synchronize through the installed executable and preserve unmanaged files
source environment.sh
mkdir -p "$TMPDIR/cache"
printf 'preserve\n' >"$TMPDIR/cache/unmanaged.txt"
PATH="$TMPDIR/node-bin" "$executable" cache sync --repo-root source --cache-path "$TMPDIR/cache" --missing-target create
PATH="$TMPDIR/node-bin" "$executable" cache check --repo-root source --cache-path "$TMPDIR/cache" --missing-target create | grep -F 'status: synchronized_directory'
cmp source/payload.txt "$TMPDIR/cache/payload.txt"
grep -Fx 'preserve' "$TMPDIR/cache/unmanaged.txt"

# should refuse ambiguous installed targets without changing either payload
source environment.sh
for marketplace in one two; do
  target="$TMPDIR/ambiguous/plugins/cache/$marketplace/sample/1.0.0"
  mkdir -p "$target"
  cp -R source/. "$target"
done
status=0
PATH="$TMPDIR/node-bin" "$executable" cache sync --repo-root source --codex-home "$TMPDIR/ambiguous" >"$TMPDIR/ambiguous.txt" || status=$?
test "$status" -eq 1
grep -F 'status: unresolved' "$TMPDIR/ambiguous.txt"
cmp source/payload.txt "$TMPDIR/ambiguous/plugins/cache/one/sample/1.0.0/payload.txt"
cmp source/payload.txt "$TMPDIR/ambiguous/plugins/cache/two/sample/1.0.0/payload.txt"

# should run the source entrypoint with only Bun available
expected=$(bun -p 'require("../../package.json").version')
cd ../..
test "$(PATH="$TMPDIR/bun-bin" bun run codex-tools --version)" = "$expected"
```
