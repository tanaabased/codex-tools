# each case owns its home, cache, and writable fixture copies.
set -euo pipefail
fixtures=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
export HOME="$root/home" CODEX_HOME="$root/codex" NO_COLOR=1 npm_config_cache="$root/npm-cache"
unset CODEX_TOOLS_REPO_ROOT CODEX_TOOLS_CACHE_PATH CODEX_TOOLS_CODEX_HOME
unset CODEX_TOOLS_MARKETPLACE CODEX_TOOLS_MARKETPLACE_PATH CODEX_TOOLS_MISSING_TARGET
unset CODEX_TOOLS_ABSENT_CHECK CODEX_TOOLS_JSON CODEX_TOOLS_DEBUG CODEX_TOOLS_DRY_RUN RUNNER_DEBUG
mkdir "$HOME"
trap 'chmod -R u+w "$root"; rm -rf "$root"' EXIT
