set -euo pipefail
root=$(mktemp -d)
root=$(cd "$root" && pwd -P)
trap 'rm -rf "$root"' EXIT
example=$PWD
mkdir "$root/tools"
tar -xzf "$CODEX_TOOLS_PACKAGE" -C "$root/tools"
export PATH="$root/tools/package/dist:$PATH"
cp -R source "$root/repo"
cd "$root/repo"
git init -q
git add .
