export function renderHelp(style) {
  return [
    'Usage: ' +
      style.bold('codex-tools') +
      ' <cache check|cache sync|status|doctor> ' +
      style.dim('[options]'),
    '',
    style.heading('Options') + ':',
    '  --repo-root <path>        local source ' + style.dim('[default: current directory]'),
    '  --cache-path <path>       explicit cache or raw target',
    '  --codex-home <path>       selected Codex home ' +
      style.dim('[default: CODEX_HOME or ~/.codex]'),
    '  --marketplace <name>      disambiguate installed caches',
    '  --missing-target <mode>  require-installed or create ' +
      style.dim('[default: require-installed]'),
    '  --absent-check <mode>    fail or neutral ' + style.dim('[default: fail]'),
    '  --dry-run                plan sync without writing',
    '  --json                   undecorated machine-readable output',
    '  --debug, --no-debug       diagnostic output on stderr',
    '  -h, --help                display help',
    '  -V, --version             report version',
    '',
    style.heading('Environment Variables') + ':',
    '  CODEX_TOOLS_REPO_ROOT       same as --repo-root',
    '  CODEX_TOOLS_CACHE_PATH      same as --cache-path',
    '  CODEX_TOOLS_CODEX_HOME      same as --codex-home; precedes CODEX_HOME',
    '  CODEX_TOOLS_MARKETPLACE     same as --marketplace',
    '  CODEX_TOOLS_MISSING_TARGET  same as --missing-target',
    '  CODEX_TOOLS_ABSENT_CHECK    same as --absent-check',
    '  CODEX_TOOLS_JSON            same as --json (1/true or 0/false)',
    '  CODEX_TOOLS_DEBUG           same as --debug (1/true or 0/false)',
    '  CODEX_TOOLS_DRY_RUN         same as --dry-run (1/true or 0/false)',
    '  TANAAB_DEBUG               enable diagnostic output',
    '',
    'Exit: 0 current/synced/planned (or explicit neutral absence); 1 drift/unavailable; 2 invalid input or I/O failure.',
    'Raw creation requires --cache-path and --missing-target create. It does not install or enable a plugin.',
    'Source package.json codexTools selects managedPaths/excludeNames and compatibility defaults.',
    'status and doctor are read-only. Plugin validation belongs to the separate validator.',
  ].join('\n');
}
