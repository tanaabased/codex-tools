# Plugin validation

`codex-tools validate --repo-root /path/to/plugin` runs the pinned official Python
validator plus shared supplemental checks. It needs no installation, cache,
`package.json`, owning skill validator, or Tanaab naming conventions.

## Dependencies and results

Use Python >=3.10 with PyYAML >=6,<7. Validation checks these dependencies but never
installs them. To prepare an isolated environment explicitly:

```sh
python3 -m venv /path/to/validator-venv
/path/to/validator-venv/bin/python -m pip install 'PyYAML>=6,<7'
codex-tools validate --repo-root /path/to/plugin --python /path/to/validator-venv/bin/python --json
```

`--python` overrides `CODEX_TOOLS_PYTHON`, then defaults to `python3`. Relative
executable paths resolve from the invocation directory. Python runs in isolated,
no-bytecode mode, outside the plugin directory; plugin-local Python modules and
`PYTHONPATH` do not supply validator imports. The Python helper is distributed
with the package, not located through a workstation-specific Codex installation.

Exit codes: **0** passes the selected checks; **1** means invalid input data,
unsupported contract coverage, or a failing repository check; **2** means missing
dependencies, invalid invocation, or an unexpected I/O failure. JSON is one
undecorated stdout object. `upstream`, `dependency`, and `repository` preserve
captured stdout, stderr, process exit status, signal, and spawn errors. Each
process has a 60-second timeout and an 8 MiB output limit; exceeding either fails
validation. Resource preflight failure skips upstream execution, explicitly, so
the Python validator cannot read an already-detected escaping resource.

## Pinned contract and limits

The unchanged `validate_plugin.py` and `identifier_validation.py` come from
[Codex 0.153.4, revision 3d2ee51](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/skills/src/assets/samples/plugin-creator/scripts).
They match the selected installed system skill byte-for-byte. SHA-256 values,
source directory, and release identity are in `vendor/openai/provenance.json`.
The upstream Apache-2.0 license permits redistribution subject to its terms;
the upstream `LICENSE` and `NOTICE` are retained alongside the Python files in
both source and packaged artifacts. Package-owned adaptations remain MIT.

This is the **legacy `.codex-plugin/plugin.json` ingestion contract**, not a claim
to validate every format the Codex loader accepts. It requires name, strict
semver, description, author.name, and the validator's required interface fields.
Skills use `./skills/`; apps use `./.app.json`; MCP uses `./.mcp.json` or the
upstream inline server-object form. Shared checks retain the consumers' `./`
path convention. Both default-prompt spellings receive string/array checks.

Unknown manifest fields (including `hooks`), portable/component declarations,
and nonconventional resource layouts produce `status: unsupported`, named
coverage gaps, and a failing result. Upstream failures are not filtered out or
rewritten into passes. The upstream sample spec itself mentions hooks but its
validator rejects them. A pass covers the selected ingestion checks, not hook
execution, remote services, installation behavior, or every possible MCP setting.
Portable migration is not required here.

The three commit-pinned consumer manifests are regression fixtures, validated
unchanged in meaning with standalone generated assets, companion files, and
minimal skills. This proves manifest compatibility, not that every current
consumer skill passes upstream's stricter ingestion rules. In particular,
`disable-model-invocation: true` fails upstream. No consumer policies are waived.

## Explicit repository integration

Nothing in a plugin selects programs to run. Neither `package.json`, custom
scripts, automatic config discovery, nor environment variables activate
repository checks. A trusted caller may pass `--repository-checks checks.json`:

```json
[
  {
    "name": "owning repository validation",
    "command": "bun",
    "args": ["scripts/validate-repository.js"]
  }
]
```

This explicitly authorizes those programs, with the plugin root as their working
directory. They are not sandboxed by this library. Commands receive literal
argument arrays, not shell strings; diagnostics are captured and nonzero exits,
signals, timeouts, and missing commands fail the combined result. Descriptor
files resolve from `--repo-root`. They must contain an array of unique nonempty
names, executable commands, and string argument arrays. API callers use
`validatePlugin({ repoRoot, python, repositoryChecks })` with the same descriptors.
`runOperation('validate', options)` is also available to consumer wrappers.

The owning script must invoke **all** its existing policy checks and exit nonzero
when any fails. Retain Me's `validateSkillDir`, `loadAutomationManifest`, and
`loadModelRoutingPolicy`, or Canon's `validate-skill.js`, in that script. Keep
required resources there too: Me requires skills, composerIcon, logo, and MCP;
Canon requires skills, composerIcon, and logo. These presence requirements are
repository policy, whereas declared-path containment and file types are shared.
Do not point a descriptor at a migrated wrapper that invokes itself recursively.

The package exports these read-only helpers for that script:

| Helper                                                                                 | Caller-owned scope and result                                                                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `validatePromptReferences({ manifest, skillNames, requireInstalledReference = true })` | Me's starter-prompt semantics: nonempty prompts, reject unknown `$skill` references, require at least one installed reference by default. |
| `validateMarkdownLinks({ repoRoot, roots })`                                           | Explicit file/directory roots; Canon's external, templated, title, and anchor handling; resolved containment.                             |
| `validateWorkflowPackageScripts({ repoRoot })`                                         | Me/Canon's workflow references to `bun/npm/pnpm/yarn run`; missing scripts fail without executing commands.                               |

Each helper returns `{ ok, failures }`; the owning script must report failures
and propagate a failing exit. Canon retains its roots: README.md, CHANGELOG.md,
AGENTS.md, guidance, ideas, references, prompts, and templates. No such list is a
generic default. Standalone output explicitly says repository checks were
`not_requested`; only an explicit integration can establish repository parity.

## Existing-behavior parity

Baselines: [Me 24b5a7c](https://github.com/pirog/me/tree/24b5a7c1b97657b62687d7d2d6a383c2ac3a32ad),
[Canon a3e7a50](https://github.com/tanaabased/canon/tree/a3e7a5023b189cabfebb22dc5fc1bbe84860546b),
[Agentbox 6aa9422](https://github.com/tanaabased/agentbox/tree/6aa9422ce72553fa90dd16ea9417ecc848c17e40).
Their top-level validator sources were compared with current source during this
implementation and were unchanged.

| Existing check                                                                                   | Destination / treatment                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest JSON object, name/version/description, interface and prompt shape                       | Upstream plus retained Agentbox shape checks; semver and required ingestion metadata are stricter upstream.                                                                                                                                                                         |
| Skills/apps/MCP declarations, composerIcon/logo/logoDark/screenshots                             | Upstream plus Agentbox's declared resource existence, `./` convention, containment, resolved links, and expected type checks.                                                                                                                                                       |
| Empty skill collection, SKILL.md/frontmatter parsing, required name/description, duplicate names | Agentbox validation adapted into `validation-supplemental.js`; upstream also validates frontmatter.                                                                                                                                                                                 |
| Optional agents/openai.yaml object/interface and icon assets                                     | Upstream plus retained Agentbox checks; supplemented containment for skill directories, SKILL.md, metadata, and manifest itself.                                                                                                                                                    |
| Apps/MCP JSON objects and required root object                                                   | Upstream plus Agentbox's companion shape checks; inline MCP uses upstream semantics.                                                                                                                                                                                                |
| Me/Canon required resources                                                                      | Repository-owned presence policy invoked explicitly; not imposed on arbitrary plugins.                                                                                                                                                                                              |
| Piro/Tanaab skill conventions                                                                    | Owning skill validator, explicitly invoked: required/forbidden metadata, owner/type/tags, naming, folder rules, descriptions/license, Markdown structure/links, OpenClaw metadata, OpenAI display/prompt/color/icons, dependencies/policy, and warnings/manual checks remain there. |
| Me starter prompts                                                                               | Exported `validatePromptReferences`, adapted from Me, preserves unknown-reference and required-installed-reference failures.                                                                                                                                                        |
| Automation schema, unique IDs, prompt/file containment, scheduling and model choices             | Me's complete owning automation loader, explicitly invoked; no generic copy of policy.                                                                                                                                                                                              |
| Model-routing schema and policy                                                                  | Me's complete owning model-policy loader, explicitly invoked.                                                                                                                                                                                                                       |
| Workflow package-script references                                                               | Exported helper adapted from Me/Canon; Canon's extractor reused.                                                                                                                                                                                                                    |
| Configured root Markdown links                                                                   | Exported helper adapted from Canon; normalization reused, containment strengthened.                                                                                                                                                                                                 |
| Standalone plugin without repository tooling or naming rules                                     | Agentbox test behavior retained; no policy discovery.                                                                                                                                                                                                                               |
| CLI help/version/debug, repo override, diagnostics and failure status                            | Existing command boundary extended; validation never resolves a cache.                                                                                                                                                                                                              |

The official ingestion layer replaces relying on repository JavaScript checks
alone. Existing code is retained or adapted where it provides additional coverage;
owning policies stay callable, not silently removed. Consumer migrations remain
separate work.
