source environment.sh
bun registry.ts "$root" >"$root/registry.log" 2>&1 &
registry_pid=$!
cleanup() {
  result=$?
  if test "$result" -ne 0; then tail -30 "$root/registry.log" >&2; fi
  kill "$registry_pid" 2>/dev/null || :
  wait "$registry_pid" 2>/dev/null || :
  rm -rf "$root"
}
trap cleanup EXIT
for attempt in $(seq 1 100); do
  test ! -s "$root/registry-url" || break
  kill -0 "$registry_pid" 2>/dev/null || { cat "$root/registry.log" >&2; exit 1; }
  sleep 0.1
done
test -s "$root/registry-url" || { cat "$root/registry.log" >&2; exit 1; }
registry=$(cat "$root/registry-url")
export npm_config_registry="$registry" npm_config_cafile="$root/cert.pem"
export npm_config_fetch_retries=0 npm_config_update_notifier=false
