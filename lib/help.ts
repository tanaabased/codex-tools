import type { StyleSet } from './presentation.ts';

function rows(values: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...values.map(([label]) => label.length));
  return values.map(([label, description]) => `  ${label.padEnd(width)}  ${description}`);
}

export function renderHelp(style: StyleSet): string {
  return [
    'Usage: ' +
      style.dim('[CODEX_TOOLS_*...]') +
      ' ' +
      style.bold('codex-tools') +
      ' <command> ' +
      style.dim('[source] [options]'),
    '',
    ...rows([
      ['install', 'install a local path or npm:package'],
      ['refresh', 'refresh an installed plugin'],
      ['status, doctor', 'inspect installation and drift'],
      ['cache check', 'report cache drift'],
      ['cache sync', 'reconcile managed cache content'],
    ]),
    '',
    style.heading('Options') + ':',
    ...rows([
      ['--repo-root <path>', 'local source ' + style.dim('[default: current directory]')],
      ['--cache-path <path>', 'explicit cache or raw target'],
      ['--codex-home <path>', 'Codex state ' + style.dim('[default: CODEX_HOME or ~/.codex]')],
      ['--marketplace <name>', 'select a marketplace'],
      ['--marketplace-path <file>', 'local catalog for install/refresh'],
      [
        '--missing-target <mode>',
        'require-installed or create ' + style.dim('[default: require-installed]'),
      ],
      ['--absent-check <mode>', 'fail or neutral ' + style.dim('[default: fail]')],
      ['--dry-run', 'plan install/refresh/sync without writes or child processes'],
      ['--json', 'machine-readable output'],
      ['--debug', 'diagnostics on stderr'],
      ['-h, --help', 'display help'],
      ['-V, -v, --version', 'report version'],
    ]),
    '',
    style.heading('Environment Variables') + ':',
    ...rows([
      ['CODEX_TOOLS_REPO_ROOT', 'same as --repo-root'],
      ['CODEX_TOOLS_CACHE_PATH', 'same as --cache-path'],
      ['CODEX_TOOLS_CODEX_HOME', 'same as --codex-home; precedes CODEX_HOME'],
      ['CODEX_TOOLS_MARKETPLACE', 'same as --marketplace'],
      ['CODEX_TOOLS_MARKETPLACE_PATH', 'same as --marketplace-path'],
      ['CODEX_TOOLS_MISSING_TARGET', 'same as --missing-target'],
      ['CODEX_TOOLS_ABSENT_CHECK', 'same as --absent-check'],
      ['CODEX_TOOLS_JSON', 'same as --json'],
      ['CODEX_TOOLS_DEBUG', 'same as --debug'],
      ['CODEX_TOOLS_DRY_RUN', 'same as --dry-run'],
    ]),
  ].join('\n');
}
