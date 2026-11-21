# Codex Tools runtime selection

1. Start in the project the user wants to work on. If it already has `@tanaab/codex-tools` installed, use its documented launcher if it resolves that installed copy. Otherwise use the matching `node_modules/.bin/codex-tools`, including the workspace root if the dependency is installed there. Check which package the launcher resolves before running it.
2. If there is no project copy, use `dist/codex-tools` in the installed Codex Tools plugin, two directories above the invoking skill's `SKILL.md`. This launcher needs Node. Check that its version matches the plugin's `package.json`.
3. If the selected launcher is unavailable or lacks the required command, report the path and any version you can confirm. Ask before switching to a different version. Use the selected launcher for preview, apply, and readback. Avoid bare PATH commands and package runners that might fetch a different release.
