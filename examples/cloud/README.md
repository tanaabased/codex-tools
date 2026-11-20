# Cloud skill packaging

The fixture ships a writer with a command asset, an inspector with a standalone command, change notes with shared references, and a prose-only skill.

## Testing

```bash
# should produce the same command skill from a nested directory and the repository config
source environment.sh
echo root=true > refs/.editorconfig
git add refs/.editorconfig
cp -R "$root/repo" "$root/single"
(cd "$root/single/skills/writer/scripts" && codex-tools cloud package)
test ! -e "$root/single/skills/inspector/runtime-files.json"
codex-tools cloud package
diff -r "$root/single/skills/writer" skills/writer
cmp refs/.editorconfig skills/writer/refs/.editorconfig
test -f skills/inspector/runtime-files.json
test ! -L skills/changes/refs
cmp refs/example.md skills/changes/refs/example.md
git diff --exit-code -- skills/notes

# should discover a new prose skill and run a verified command from the extracted release
source environment.sh
mkdir skills/new
printf '%s\n' '---' 'name: new' 'description: Record a note.' '---' '' '# New' '' 'Record a note.' > skills/new/SKILL.md
git add skills/new
codex-tools cloud package
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.3.tgz" -C "$root"
codex-tools cloud verify --package "$root/package" --json | grep -F '"skills/new"'
test "$(node "$example/run-copied.mjs" "$root/package/skills/writer" "$root/standalone")" = 'hello from the bundle'

# should reject a transitive escape during packaging and name the broken link
source environment.sh
echo '[outside](../../../shared.js)' > refs/example.md
status=0
codex-tools cloud package skills/writer/build.config.js >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'skills/writer/refs/example.md → ../../../shared.js' "$root/log"
grep -F 'inside the skill' "$root/log"

# should reject a reference omitted by npm even though packaging succeeded
source environment.sh
codex-tools cloud package
echo refs/example.md > skills/writer/.npmignore
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.3.tgz" -C "$root"
test ! -e "$root/package/skills/writer/refs/example.md"
status=0
codex-tools cloud verify --package "$root/package" >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'skills/writer/refs/guide.md → example.md' "$root/log"

# should detect a missing inventory entry even when its bundled command ships
source environment.sh
codex-tools cloud package
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.3.tgz" -C "$root"
node -e 'const fs=require("node:fs"), file=process.argv[1], data=JSON.parse(fs.readFileSync(file)); data.commands=[]; fs.writeFileSync(file,JSON.stringify(data))' "$root/package/skills/writer/runtime-files.json"
test -f "$root/package/skills/writer/scripts/write.js"
status=0
codex-tools cloud verify --package "$root/package" >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'scripts/write.js' "$root/log"
```
