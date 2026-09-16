# CLI options

Exercise the built executable's reporting and strict failures.

## Testing

```bash
# should report help from outside the checkout
cd /tmp
codex-tools --help | grep -F 'Usage: codex-tools'

# should report a version
codex-tools --version | grep -E '^[0-9]+\.[0-9]+\.[0-9]+'

# should reject unknown flags even with help
set +e
output=$(codex-tools --help --unknown --json 2>/dev/null)
status=$?
set -e
test "$status" -eq 2
printf '%s' "$output" | bun -e 'const r = await Bun.stdin.json(); if (r.ok || r.status !== "error") process.exit(1)'
```
