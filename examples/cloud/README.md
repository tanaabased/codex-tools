# Cloud skill packaging

The writer bundles two commands. Change notes use the same references, templates, and icons without bundling commands. The inspector and plain notes exercise separate skill selection.

## Testing

```bash
# should produce the same command skill from a nested directory and the repository config
source environment.sh
echo root=true > refs/.editorconfig
echo 'name: example' > templates/workflow.yml
echo 'build only' > templates/packaged-command-execution.md
git add refs/.editorconfig templates
echo 'local only' > refs/local.txt
cp -R "$root/repo" "$root/single"
(cd "$root/single/skills/writer/scripts" && codex-tools cloud package)
test ! -e "$root/single/skills/inspector/runtime-files.json"
(cd skills/notes && codex-tools cloud package)
diff -r "$root/single/skills/writer" skills/writer
cmp refs/.editorconfig skills/writer/refs/.editorconfig
test ! -e skills/writer/refs/local.txt
test ! -e skills/writer/templates/packaged-command-execution.md
cmp templates/workflow.yml skills/writer/templates/workflow.yml
test ! -L skills/writer/refs/guide.md
cmp refs/guide.md skills/writer/refs/guide.md
cmp "$example/source/skills/writer/templates/greeting.md" skills/writer/templates/greeting.md
cmp templates/greeting.md skills/changes/templates/greeting.md
test ! -L skills/changes/refs
cmp refs/example.md skills/changes/refs/example.md
test ! -e skills/changes/runtime-files.json
test -f skills/inspector/runtime-files.json
git diff --exit-code -- skills/notes skills/changes/SKILL.md

# should run verified .js and .mjs commands with only their inventoried files from the extracted release
source environment.sh
mkdir skills/new
printf '%s\n' '---' 'name: new' 'description: Record a note.' '---' '' '# New' '' 'Record a note.' > skills/new/SKILL.md
git add skills/new
npm pkg set version=1.2.4
codex-tools cloud package
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.4.tgz" -C "$root"
codex-tools cloud verify --package "$root/package" --json --debug 2>"$root/debug" | grep -F '"skills/new"'
grep -F "\"configPath\":\"$root/repo/cloud.config.js\"" "$root/debug"
grep -F "\"packageDirectory\":\"$root/package\"" "$root/debug"
grep -F '(DOCS_URL)' "$root/package/skills/writer/templates/greeting.md"
grep -F '### Packaged Command Execution' "$root/package/skills/writer/SKILL.md"
cmp skills/writer/assets/icon.png "$root/package/skills/changes/assets/icon.png"
greeting=$(node "$example/run-copied.mjs" "$root/package/skills/writer" "$root/standalone")
test "$greeting" = 'hello from the bundle'
rm "$root/package/skills/changes/assets/icon.png"
status=0
codex-tools cloud verify --package "$root/package" >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'skills/changes/agents/openai.yaml → ./assets/icon.png' "$root/log"

# should accept the probed reader formats and follow Markdown links through compound names
source environment.sh
cd skills/notes
echo 'export default {};' > build.config.js
for file in sample.{c,css,csv,h,htm,html,js,json,md,mjs,py,rst,sh,svg,tsv,txt,xml} uppercase.{JS,JSON,MD,TXT} sample.png.txt sample.yml.md sample.svelte.html; do
  echo sample > "$file"
  printf '\n[%s](%s)\n' "$file" "$file" >> SKILL.md
done
git add .
codex-tools cloud package --json | grep -F '"skills/notes"'
previous=sample.yml.md
for n in {1..11}; do
  printf '[next](page%s.md)\n' "$n" > "$previous"
  previous="page$n.md"
done
echo '[missing](absent.md)' > "$previous"
git add .
status=0
codex-tools cloud package >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'skills/notes/page11.md → absent.md: link a concrete packaged file' "$root/log"

# should reject packaged files with unsupported suffixes, dotfiles and extensionless names
source environment.sh
cd skills/notes
echo 'export default {};' > build.config.js
for file in sample.cjs sample.ts valid.png sample .prettierignore; do
  echo sample > "$file"
  printf '[resource](%s)\n' "$file" > SKILL.md
  git add .
  status=0
  codex-tools cloud package >"$root/log" 2>&1 || status=$?
  test "$status" -ne 0
  grep -F "skills/notes/SKILL.md → $file: link an annotated Markdown file" "$root/log"
done

# should still reject an unreadable file linked from a template with a URL placeholder
source environment.sh
echo 'name: example' > skills/writer/templates/workflow.yml
echo '[starter](workflow.yml)' >> skills/writer/templates/greeting.md
status=0
codex-tools cloud package skills/writer/build.config.js >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'skills/writer/templates/greeting.md → workflow.yml' "$root/log"
grep -F 'workflow.yml.md' "$root/log"

# should reject an external import retained in the emitted command
source environment.sh
echo 'import "https://example.invalid/runtime.js";' >> skills/writer/scripts/write.js
status=0
codex-tools cloud package skills/writer/build.config.js >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'scripts/write.js: bundle has an external dependency: https://example.invalid/runtime.js' "$root/log"

# should reject TypeScript, CommonJS and shell files selected as command entrypoints
source environment.sh
cd skills/notes
for ext in ts cjs sh; do
  touch "run.$ext"
  echo "export default { entrypoints: 'run.$ext' }" > build.config.js
  git add .
  status=0
  codex-tools cloud package >"$root/log" 2>&1 || status=$?
  test "$status" -ne 0
  grep -F "skills/notes/run.$ext: command entrypoints must end in .js or .mjs" "$root/log"
done

# should reject an unreadable emitted resource before overwriting the source command
source environment.sh
cd skills/writer
echo 'import icon from "../assets/icon.png" with { type: "file" }; console.log(icon);' > scripts/write.js
cp scripts/write.js "$root/original.js"
status=0
codex-tools cloud package >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F '.png: the Cloud reader cannot copy this command resource' "$root/log"
cmp "$root/original.js" scripts/write.js

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

# should require source evidence for command inventory completeness
source environment.sh
codex-tools cloud package
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.3.tgz" -C "$root"
cp -R "$root/package" "$root/shortened"
node -e 'const fs=require("node:fs"), file=process.argv[1], data=JSON.parse(fs.readFileSync(file)); data.commands=data.commands.filter(c => c.path !== "scripts/write.js"); fs.writeFileSync(file,JSON.stringify(data))' "$root/shortened/skills/writer/runtime-files.json"
test -f "$root/shortened/skills/writer/scripts/write.js"
for package in "$root/package" "$root/shortened"; do
  status=0
  (cd "$package" && codex-tools cloud verify --package .) >"$root/log" 2>&1 || status=$?
  test "$status" -eq 2
  grep -F 'Command inventory completeness could not be established' "$root/log"
  grep -F 'Run cloud verify from the source checkout or pass its config path' "$root/log"
done
(cd "$root/package" && codex-tools cloud verify "$root/repo/cloud.config.js" --package .)
status=0
codex-tools cloud verify --package "$root/shortened" >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F 'inventory commands differ from tracked entrypoints. Expected scripts/icons.mjs, scripts/write.js' "$root/log"

# should reject an unreadable inventoried resource even when its extracted bytes match
source environment.sh
codex-tools cloud package
npm pack --silent --pack-destination "$root"
tar -xzf "$root/fictional-cloud-skills-1.2.3.tgz" -C "$root"
writer="$root/package/skills/writer"
resource=$(node -p "require(process.argv[1]).commands.find(c => c.path === 'scripts/write.js').resources[0].path" "$writer/runtime-files.json")
mv "$writer/$resource" "$writer/$resource.yaml"
sed -i.bak 's/\.txt"/.txt.yaml"/g' "$writer/runtime-files.json"
status=0
codex-tools cloud verify --package "$root/package" >"$root/log" 2>&1 || status=$?
test "$status" -ne 0
grep -F "skills/writer/$resource.yaml: the Cloud reader cannot copy this command resource" "$root/log"
```
