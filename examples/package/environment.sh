repo=$(cd ../.. && pwd -P)
consumer="$TMPDIR/consumer"
installed="$consumer/node_modules/@tanaab/codex-tools"
executable="$installed/dist/codex-tools"
export HOME="$TMPDIR/home" CODEX_HOME="$TMPDIR/codex" NO_COLOR=1
cd "$consumer"
