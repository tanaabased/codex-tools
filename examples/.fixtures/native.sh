source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"
plugin="$root/external plugin ' \$(literal)"
cp -R "$fixtures/plugin" "$plugin"
