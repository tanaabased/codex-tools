# Default selection

Exercise default source, Codex home, and Cloud config discovery without selection overrides.

## Testing

```bash
# should inspect the current source and default Codex home
source environment.sh
unset CODEX_HOME
target="$HOME/.codex/plugins/cache/personal/default-example/1.0.0"
mkdir -p "$target"
cp -R source/. "$target"
cd source
codex-tools status --json >"$root/status.json"
grep -F '"status":"current"' "$root/status.json"
grep -F "\"path\":\"$PWD\"" "$root/status.json"
grep -F "\"codexHome\":\"$HOME/.codex\"" "$root/status.json"
CODEX_HOME='' codex-tools status --json >"$root/empty.json"
cmp "$root/status.json" "$root/empty.json"

# should stop default cloud config discovery at the checkout root
source environment.sh
echo 'export default { skills: "skills/*/SKILL.md" };' > "$root/cloud.config.js"
git init -q "$root/project"
mkdir "$root/project/nested"
cd "$root/project/nested"
status=0
codex-tools cloud package 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F "No build.config.js or cloud.config.js found through $root/project" "$root/error"
```
