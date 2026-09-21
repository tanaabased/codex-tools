# CLI inputs

Exercise the built executable's help, option forms, environment precedence, boolean controls, and
strict failures without mutating Codex state.

## Testing

```bash
# should report help and displayed defaults from outside the checkout
cd /tmp
codex-tools --help | grep -F 'codex-tools <command> [source] [options]'
codex-tools --help | grep -E 'CODEX_TOOLS_CODEX_HOME +same as --codex-home; precedes CODEX_HOME'
codex-tools --help | grep -F '[default: current directory]'
codex-tools --help | grep -F '[default: CODEX_HOME or ~/.codex]'
codex-tools --help | grep -F '[default: require-installed]'
codex-tools --help | grep -F '[default: fail]'

# should report a version from outside the checkout
cd /tmp
codex-tools --version | grep -E '^[0-9]+[.][0-9]+[.][0-9]+'

# should apply codex home precedence from flag to scoped environment to codex environment
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
common="CODEX_TOOLS_REPO_ROOT=$PWD/source CODEX_TOOLS_ABSENT_CHECK=neutral"
flag=$(env $common CODEX_HOME="$root/codex" CODEX_TOOLS_CODEX_HOME="$root/scoped" codex-tools status --codex-home="$root/flag" --json)
scoped=$(env $common CODEX_HOME="$root/codex" CODEX_TOOLS_CODEX_HOME="$root/scoped" codex-tools status --json)
codex=$(env $common CODEX_HOME="$root/codex" codex-tools status --json)
printf '%s\n%s\n%s\n' "$flag" "$scoped" "$codex" | FLAG="$root/flag" SCOPED="$root/scoped" CODEX="$root/codex" bun -e 'const rows = (await Bun.stdin.text()).trim().split("\n").map(JSON.parse); if (rows[0].codexHome !== process.env.FLAG || rows[1].codexHome !== process.env.SCOPED || rows[2].codexHome !== process.env.CODEX) process.exit(1)'

# should fall back to the selected home directory
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
output=$(env -u CODEX_HOME -u CODEX_TOOLS_CODEX_HOME HOME="$root/home" CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral codex-tools status --json)
printf '%s' "$output" | EXPECTED="$root/home/.codex" bun -e 'const r = await Bun.stdin.json(); if (!r.ok || r.codexHome !== process.env.EXPECTED) process.exit(1)'

# should accept supported boolean environment values and explicit negation
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral CODEX_TOOLS_JSON=1 CODEX_TOOLS_DEBUG=true codex-tools status --codex-home "$root/home" >"$root/json" 2>"$root/debug"
bun -e 'const r = await Bun.file(process.argv[1]).json(); if (!r.ok || r.status !== "not_installed") process.exit(1)' "$root/json"
grep -F 'debug:' "$root/debug"
CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral CODEX_TOOLS_JSON=true CODEX_TOOLS_DEBUG=true codex-tools status --codex-home "$root/home" --no-json --debug=false >"$root/text" 2>"$root/quiet"
grep -F 'status: not_installed' "$root/text"
test ! -s "$root/quiet"
CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral CODEX_TOOLS_JSON=0 CODEX_TOOLS_DEBUG=false codex-tools status --codex-home "$root/home" >"$root/falsey" 2>"$root/falsey-error"
grep -F 'status: not_installed' "$root/falsey"
test ! -s "$root/falsey-error"

# should honor ci debug and ignore unrelated environment controls
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
env -u CODEX_TOOLS_DEBUG -u RUNNER_DEBUG CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral TANAAB_DEBUG=on codex-tools status --codex-home "$root/home" >"$root/tanaab" 2>"$root/tanaab-debug"
CODEX_TOOLS_REPO_ROOT="$PWD/source" CODEX_TOOLS_ABSENT_CHECK=neutral RUNNER_DEBUG=1 codex-tools status --codex-home "$root/home" >"$root/runner" 2>"$root/runner-debug"
grep -F 'status: not_installed' "$root/tanaab"
grep -F 'status: not_installed' "$root/runner"
test ! -s "$root/tanaab-debug"
grep -F 'debug:' "$root/runner-debug"

# should reject invalid input before filesystem effects
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
set +e
output=$(CODEX_TOOLS_JSON=true CODEX_TOOLS_DEBUG=sometimes codex-tools status --repo-root source --codex-home "$root/home" 2>"$root/error")
status=$?
set -e
test "$status" -eq 2
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (r.ok || r.status !== "error" || !r.error.includes("Invalid boolean")) process.exit(1)'
grep -F 'error:' "$root/error"
test ! -e "$root/home"

# should reject unknown flags even with help
set +e
output=$(codex-tools --help --unknown --json 2>/dev/null)
status=$?
set -e
test "$status" -eq 2
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (r.ok || r.status !== "error") process.exit(1)'
```
