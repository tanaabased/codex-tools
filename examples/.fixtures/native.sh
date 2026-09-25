# sourced by each native leia case; state and child environments are disposable.
set -euo pipefail
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
registry_pid=
cleanup() {
  result=$?
  if test "$result" -ne 0 && test -f "$root/last-result.json"; then cat "$root/last-result.json" >&2; fi
  if test -n "$registry_pid"; then
    kill "$registry_pid" 2>/dev/null || :
    wait "$registry_pid" 2>/dev/null || :
  fi
  chmod -R u+w "$root"
  rm -rf "$root"
}
trap cleanup EXIT
mkdir "$root/home"
native_env=("PATH=$PATH" "HOME=$root/home" "CODEX_HOME=$root/codex" "TMPDIR=$root" "NO_COLOR=1")
native() { (cd "$root/home" && env -i "${native_env[@]}" "$@"); }
cli() { native codex-tools "$@" | tee "$root/last-result.json"; }
source="$root/external plugin ' \$(literal)"
mkdir -p "$source/.codex-plugin" "$source/skills/probe"
printf '%s\n' '{"name":"codex-tools-smoke","version":"1.0.0","skills":"./skills/"}' > "$source/.codex-plugin/plugin.json"
printf '%s\n' '---' 'name: probe' 'description: Disposable installation probe.' '---' '# Probe' 'Return probe.' > "$source/skills/probe/SKILL.md"
start_registry() {
  bun ../.fixtures/registry.ts "$root" >"$root/registry.log" 2>&1 &
  registry_pid=$!
  for attempt in $(seq 1 100); do
    test ! -s "$root/registry-url" || break
    kill -0 "$registry_pid" 2>/dev/null || { cat "$root/registry.log" >&2; return 1; }
    sleep 0.1
  done
  test -s "$root/registry-url" || { cat "$root/registry.log" >&2; return 1; }
  registry=$(cat "$root/registry-url")
  native_env+=("npm_config_registry=$registry" "npm_config_cafile=$root/cert.pem" "npm_config_cache=$root/npm-cache" "npm_config_fetch_retries=0" "npm_config_update_notifier=false")
}
