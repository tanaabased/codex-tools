# CLI inputs

Exercise help, version, environment precedence, output controls, and invalid input through the
built executable. Parser edge cases remain in the unit suite.

## Testing

```bash
# should show help and a version outside the checkout
source environment.sh
expected=$(bun -p 'require("../../package.json").version')
cd "$HOME"
codex-tools --help | grep -F 'codex-tools <command> [source] [options]'
codex-tools --help | grep -F '[default: current directory]'
codex-tools --help | grep -F '[default: CODEX_HOME or ~/.codex]'
test "$(codex-tools --version)" = "$expected"

# should prefer the flag over scoped and native Codex environment defaults
source environment.sh
export CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral
export CODEX_TOOLS_CODEX_HOME="$root/scoped"
codex-tools status --codex-home "$root/flag" --json | grep -F "\"codexHome\":\"$root/flag\""
codex-tools status --json | grep -F "\"codexHome\":\"$root/scoped\""
unset CODEX_TOOLS_CODEX_HOME
codex-tools status --json | grep -F "\"codexHome\":\"$CODEX_HOME\""

# should accept environment output controls and explicit overrides
source environment.sh
export CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral CODEX_TOOLS_JSON=true CODEX_TOOLS_DEBUG=true
codex-tools status 2>"$root/debug" | grep -F '"status":"not_installed"'
grep -F 'debug:' "$root/debug"
codex-tools status --no-json --debug=false 2>"$root/quiet" | grep -F 'status: not_installed'
test ! -s "$root/quiet"

# should honor CI debug without adopting unrelated debug settings
source environment.sh
export CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral
TANAAB_DEBUG=on codex-tools status 2>"$root/quiet"
test ! -s "$root/quiet"
RUNNER_DEBUG=1 codex-tools status 2>"$root/debug"
grep -F 'debug:' "$root/debug"

# should reject invalid environment input before creating state
source environment.sh
status=0
CODEX_TOOLS_DEBUG=sometimes codex-tools status --repo-root source --json >"$root/result.json" 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F '"status":"error"' "$root/result.json"
grep -F 'Invalid boolean' "$root/error"
test ! -e "$CODEX_HOME"

# should reject unknown flags even with help
source environment.sh
status=0
codex-tools --help --unknown --json >"$root/result.json" 2>"$root/error" || status=$?
test "$status" -eq 2
grep -F '"status":"error"' "$root/result.json"
grep -F 'Unknown option' "$root/error"
```
