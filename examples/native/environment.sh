# each case owns its home, cache, and writable fixture copies.
set -euo pipefail
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
export HOME="$root/home" CODEX_HOME="$root/codex" XDG_CACHE_HOME="$root/cache"
export NO_COLOR=1 npm_config_cache="$root/npm-cache"
unset CODEX_TOOLS_REPO_ROOT CODEX_TOOLS_CACHE_PATH CODEX_TOOLS_CODEX_HOME
unset CODEX_TOOLS_MARKETPLACE CODEX_TOOLS_MARKETPLACE_PATH CODEX_TOOLS_MISSING_TARGET
unset CODEX_TOOLS_ABSENT_CHECK CODEX_TOOLS_JSON CODEX_TOOLS_DEBUG CODEX_TOOLS_DRY_RUN RUNNER_DEBUG
mkdir "$HOME"
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) codex_target=aarch64-apple-darwin ;;
  Darwin:x86_64) codex_target=x86_64-apple-darwin ;;
  Linux:aarch64) codex_target=aarch64-unknown-linux-musl ;;
  Linux:x86_64) codex_target=x86_64-unknown-linux-musl ;;
  *) printf 'unsupported native test host\n' >&2; exit 2 ;;
esac
export CODEX_TOOLS_TEST_CODEX="$XDG_CACHE_HOME/codex-tools/codex/0.154.0/$codex_target/codex"
export PATH="$PWD/bin:$PATH"
trap 'chmod -R u+w "$root"; rm -rf "$root"' EXIT
