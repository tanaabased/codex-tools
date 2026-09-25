## {{ UNRELEASED_VERSION }} - [{{ UNRELEASED_DATE }}]({{ UNRELEASED_LINK }})

## v1.0.1 - [September 25, 2026](https://github.com/tanaabased/codex-tools/releases/tag/v1.0.1)

- Fixed local plugin installation through symlinked home and marketplace paths. [#32](https://github.com/tanaabased/codex-tools/pull/32)
- Fixed stable npm releases to update `edge` alongside `latest`. [#31](https://github.com/tanaabased/codex-tools/pull/31)
- Removed separate GitHub Release plugin archives; the Codex plugin ships in the npm package. [#34](https://github.com/tanaabased/codex-tools/pull/34)
- Updated CLI integration tests to self-contained Leia examples on macOS and Ubuntu. [#32](https://github.com/tanaabased/codex-tools/pull/32) [#34](https://github.com/tanaabased/codex-tools/pull/34)

## v1.0.0 - [September 21, 2026](https://github.com/tanaabased/codex-tools/releases/tag/v1.0.0)

### Plugin installation and refresh

- Added automatic personal marketplace setup for local plugins while preserving existing entries and source mappings. [#9](https://github.com/tanaabased/codex-tools/pull/9)
- Added local plugin installation through Codex, with installation and enablement readback. [#9](https://github.com/tanaabased/codex-tools/pull/9)
- Added local source refresh with cachebuster versions and native reinstallation, without requiring a new package release. [#10](https://github.com/tanaabased/codex-tools/pull/10)
- Added npm plugin installation from exact versions, tags, or ranges, recording the resolved release and registry. [#11](https://github.com/tanaabased/codex-tools/pull/11)
- Added npm refresh that retains the installed release pin; use `install` to select a newer release. [#11](https://github.com/tanaabased/codex-tools/pull/11)

### Cache inspection and synchronization

- Added `cache check` and `cache sync` for consumer-defined managed paths or whole-tree payloads, with configurable exclusions. [#7](https://github.com/tanaabased/codex-tools/pull/7)
- Added explicit raw-target creation and configurable missing-installation checks for existing repository integrations. [#7](https://github.com/tanaabased/codex-tools/pull/7)
- Added preservation of unmanaged files, excluded content, executable modes, and unchanged files during cache synchronization. [#7](https://github.com/tanaabased/codex-tools/pull/7)
- Added read-only `status` and `doctor` commands for plugin identity, registration, enablement, and payload drift. [#7](https://github.com/tanaabased/codex-tools/pull/7)
- Fixed explicit whole-tree selection when a consumer otherwise declares managed paths. [#27](https://github.com/tanaabased/codex-tools/pull/27)

### CLI, library, and agent skills

- Added a Node CLI with JSON output, environment defaults, explicit option precedence, and diagnostics on stderr. [#21](https://github.com/tanaabased/codex-tools/pull/21) [#27](https://github.com/tanaabased/codex-tools/pull/27)
- Added CLI and API references, executable examples, and guides for cache ownership, npm pinning, and recovery. [#23](https://github.com/tanaabased/codex-tools/pull/23) [#25](https://github.com/tanaabased/codex-tools/pull/25)
- Added setup and maintenance skills for Codex and compatible OpenClaw bundles, both invoking the packaged CLI. [#26](https://github.com/tanaabased/codex-tools/pull/26) [#29](https://github.com/tanaabased/codex-tools/pull/29)
- Added typed ESM and CommonJS APIs for installation, refresh, inspection, cache comparison, and synchronization. [#20](https://github.com/tanaabased/codex-tools/pull/20) [#21](https://github.com/tanaabased/codex-tools/pull/21)

### Safety and verification

- Added `--dry-run` plans for installation, refresh, and synchronization without writes or child processes. [#7](https://github.com/tanaabased/codex-tools/pull/7) [#9](https://github.com/tanaabased/codex-tools/pull/9) [#10](https://github.com/tanaabased/codex-tools/pull/10) [#11](https://github.com/tanaabased/codex-tools/pull/11)
- Added guards against ambiguous targets, overlapping roots, conflicting marketplace entries, and unsafe cache replacement. [#7](https://github.com/tanaabased/codex-tools/pull/7) [#9](https://github.com/tanaabased/codex-tools/pull/9)
- Added npm failure redaction and partial-effect reporting so failed operations retain useful diagnostics without promising rollback. [#10](https://github.com/tanaabased/codex-tools/pull/10) [#11](https://github.com/tanaabased/codex-tools/pull/11)
- Added packed-package checks for Node consumers, type exports, bundled skills, and assets, plus isolated native Codex probes. [#22](https://github.com/tanaabased/codex-tools/pull/22) [#26](https://github.com/tanaabased/codex-tools/pull/26)
- Fixed native discovery verification to require exact, enabled skill names in the requested directory. [#30](https://github.com/tanaabased/codex-tools/pull/30)

## v1.0.0-beta.1 - [September 21, 2026](https://github.com/tanaabased/codex-tools/releases/tag/v1.0.0-beta.1)

- Added Codex plugin installation from local source and npm with automatic marketplace setup. [#9](https://github.com/tanaabased/codex-tools/pull/9) [#11](https://github.com/tanaabased/codex-tools/pull/11)
- Added installation diagnostics, dry runs, and consumer-defined cache comparison and synchronization. [#7](https://github.com/tanaabased/codex-tools/pull/7)
- Added local plugin refresh through Codex's native reinstall flow. [#10](https://github.com/tanaabased/codex-tools/pull/10)
- Added setup and maintenance skills backed by the packaged CLI. [#26](https://github.com/tanaabased/codex-tools/pull/26)
- Added the Node CLI and typed ESM/CommonJS library distributions. [#20](https://github.com/tanaabased/codex-tools/pull/20) [#21](https://github.com/tanaabased/codex-tools/pull/21)
- Fixed explicit whole-tree cache selection when a consumer declares managed paths. [#27](https://github.com/tanaabased/codex-tools/pull/27)
