import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlugin } from '../lib/validation.js';
import {
  validateMarkdownLinks,
  validatePromptReferences,
  validateWorkflowPackageScripts,
} from '../lib/repository-validation.js';
import { parseArgs } from '../utils/parse-args.js';
import { fixture, put } from './validation-fixture.js';

const python = process.env.CODEX_TOOLS_PYTHON ?? 'python3';
const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repo, 'bin/codex-tools.js');

describe('standalone plugin validation', function () {
  this.timeout(15_000);
  let root, manifest, names;
  beforeEach(async () => {
    ({ root, manifest, names } = await fixture());
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const validate = (root, extra = {}) => validatePlugin({ repoRoot: root, python, ...extra });

  for (const consumer of ['me', 'canon', 'agentbox']) {
    it(
      'validates the pinned ' + consumer + ' legacy manifest with standalone resources',
      async () => {
        const f = await fixture(consumer);
        try {
          const result = await validate(f.root);
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.upstream.exitCode, 0);
          assert.equal(result.coverage.repositoryChecks, 'not_requested');
        } finally {
          await rm(f.root, { recursive: true, force: true });
        }
      },
    );
  }

  it('pins the unmodified upstream scripts by checksum', async () => {
    for (const [name, hash] of [
      ['validate_plugin.py', 'f4eeadb733b28b0c3e714de263a76d6542866a672f3e99bdffcf4dbcdf85e944'],
      [
        'identifier_validation.py',
        'a6d51ce4a9a7e8f85626ff5808a467a67574e7f8cdf1167ffb467c5f67e57223',
      ],
    ])
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(repo, 'vendor/openai', name)))
          .digest('hex'),
        hash,
      );
  });

  for (const content of ['{', 'null', '[]']) {
    it('rejects malformed or non-object manifest ' + content, async () => {
      await put(root, '.codex-plugin/plugin.json', content);
      const result = await validate(root);
      assert.equal(result.ok, false);
      assert.equal(result.upstream.exitCode, 1);
      assert.match(result.upstream.stdout, /JSON/);
    });
  }

  for (const [name, change, pattern] of [
    [
      'strict version',
      (m) => {
        m.version = 'next';
      },
      /strict semver/,
    ],
    [
      'invalid identifier',
      (m) => {
        m.name = 'bad name';
      },
      /name.*invalid/,
    ],
    [
      'author',
      (m) => {
        m.author = {};
      },
      /author.name/,
    ],
    [
      'unknown manifest format',
      (m) => {
        m.skills = ['./skills'];
      },
      /skills/,
    ],
    [
      'portable components',
      (m) => {
        m.components = {};
      },
      /components/,
    ],
    [
      'invalid prompt',
      (m) => {
        m.interface.defaultPrompt = [null];
      },
      /defaultPrompt/,
    ],
    [
      'invalid prompt alias',
      (m) => {
        m.interface.default_prompt = 42;
      },
      /defaultPrompt/,
    ],
  ]) {
    it('fails ' + name, async () => {
      change(manifest);
      await put(root, '.codex-plugin/plugin.json', manifest);
      const result = await validate(root);
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), pattern);
    });
  }

  it('reports unsupported nonconventional resource layouts', async () => {
    manifest.skills = './custom';
    await put(root, 'custom/example/SKILL.md', '---\nname: custom\ndescription: Skill.\n---\n');
    await put(root, '.codex-plugin/plugin.json', manifest);
    const result = await validate(root);
    assert.equal(result.status, 'unsupported');
    assert.match(result.coverage.unsupported.join(), /skills/);
  });

  for (const kind of ['missing', 'directory', 'escaping', 'symlink']) {
    it('rejects ' + kind + ' assets', async () => {
      await rm(join(root, manifest.interface.logo));
      if (kind === 'directory') await mkdir(join(root, manifest.interface.logo));
      if (kind === 'escaping') {
        manifest.interface.logo = './../outside.png';
        await put(root, '.codex-plugin/plugin.json', manifest);
      }
      if (kind === 'symlink') await symlink('/etc/hosts', join(root, manifest.interface.logo));
      const result = await validate(root);
      assert.equal(result.ok, false);
      assert.equal(result.upstream.skipped, true);
    });
  }

  for (const target of [
    '.codex-plugin/plugin.json',
    'skills',
    'skills/NAME/SKILL.md',
    'skills/NAME/agents/openai.yaml',
    '.mcp.json',
  ]) {
    it('rejects resolved escape at ' + target, async () => {
      const file = target.replace('NAME', names[0]);
      await rm(join(root, file), { recursive: true, force: true });
      if (file.includes('/agents/'))
        await mkdir(join(root, 'skills', names[0], 'agents'), { recursive: true });
      await symlink(target === 'skills' ? '/etc' : '/etc/hosts', join(root, file));
      const result = await validate(root);
      assert.equal(result.ok, false);
      assert.equal(result.upstream.skipped, true);
      assert.match(JSON.stringify(result.supplemental.failures), /outside/);
    });
  }

  it('rejects a symlinked skill directory escaping the plugin', async () => {
    await symlink('/etc', join(root, 'skills/escape'));
    const result = await validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.upstream.skipped, true);
  });

  it('requires declared skills to exist and contain a skill', async () => {
    await rm(join(root, 'skills'), { recursive: true });
    assert.equal((await validate(root)).ok, false);
    await mkdir(join(root, 'skills'));
    assert.match((await validate(root)).failures.join(), /at least one skill/);
  });

  it('guards conventionally discovered skills even when manifest validation exits early', async () => {
    delete manifest.interface;
    await put(root, '.codex-plugin/plugin.json', manifest);
    await symlink('/etc', join(root, 'skills/escape'));
    const result = await validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.upstream.skipped, true);
  });

  it('guards conventional skills alongside unsupported custom declarations', async () => {
    manifest.skills = './custom';
    await put(root, '.codex-plugin/plugin.json', manifest);
    await put(root, 'custom/example/SKILL.md', '---\nname: custom\ndescription: Skill.\n---\n');
    await symlink('/etc', join(root, 'skills/escape'));
    const result = await validate(root);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.upstream.skipped, true);
  });

  it('retains the upstream failure for disabled model invocation', async () => {
    await put(
      root,
      'skills/' + names[0] + '/SKILL.md',
      '---\nname: disabled\ndescription: Skill.\ndisable-model-invocation: true\n---\n',
    );
    const result = await validate(root);
    assert.equal(result.ok, false);
    assert.match(result.upstream.stdout, /disable-model-invocation/);
  });

  for (const content of [
    '---\nname: incomplete\n---\n',
    '---\n[broken\n---\n',
    '---\n- array\n---\n',
    '# No frontmatter',
    '---\nname: not-closed',
  ]) {
    it('rejects invalid skill frontmatter ' + JSON.stringify(content), async () => {
      await put(root, 'skills/' + names[0] + '/SKILL.md', content);
      assert.equal((await validate(root)).ok, false);
    });
  }

  it('rejects duplicate skill names', async () => {
    await put(
      root,
      'skills/duplicate/SKILL.md',
      '---\nname: ' + names[0] + '\ndescription: Duplicate.\n---\n',
    );
    const result = await validate(root);
    assert.equal(result.upstream.ok, true);
    assert.match(result.failures.join(), /duplicate skill name/);
  });

  for (const metadata of [
    '[broken',
    '- array',
    'interface: invalid',
    'interface:\n  display_name: Test\n  short_description: Skill\n  icon_large: ./missing.png',
    'interface:\n  display_name: Test\n  short_description: Skill\npolicy:\n  allow_implicit_invocation: nope',
  ]) {
    it(
      'rejects malformed metadata or missing skill assets ' + JSON.stringify(metadata),
      async () => {
        await put(root, 'skills/' + names[0] + '/agents/openai.yaml', metadata);
        assert.equal((await validate(root)).ok, false);
      },
    );
  }

  for (const [key, file, value] of [
    ['apps', '.app.json', { apps: [] }],
    ['mcpServers', '.mcp.json', { mcpServers: [] }],
    ['apps', '.app.json', '{'],
    ['mcpServers', '.mcp.json', '[]'],
    ['apps', '.app.json', { apps: { sample: {} } }],
  ]) {
    it('rejects invalid companion ' + key + ' ' + JSON.stringify(value), async () => {
      manifest[key] = './' + file;
      await put(root, '.codex-plugin/plugin.json', manifest);
      await put(root, file, value);
      assert.equal((await validate(root)).ok, false);
    });
  }

  it('supports upstream inline MCP objects', async () => {
    manifest.mcpServers = { sample: { command: 'never-executed' } };
    await put(root, '.codex-plugin/plugin.json', manifest);
    assert.equal((await validate(root)).ok, true);
  });

  it('retains Me prompt-reference policy only when explicitly invoked', async () => {
    manifest.interface.defaultPrompt = ['Use $unknown-skill.'];
    await put(root, '.codex-plugin/plugin.json', manifest);
    assert.equal((await validate(root)).ok, true);
    const result = validatePromptReferences({ manifest, skillNames: names });
    assert.equal(result.ok, false);
    assert.match(result.failures.join(), /unknown skill/);
    assert.match(result.failures.join(), /at least one installed/);
    assert.equal(
      validatePromptReferences({
        manifest: { interface: { defaultPrompt: ['Use $' + names[0]] } },
        skillNames: names,
      }).ok,
      true,
    );
  });

  it('reports missing Python without installing anything', async () => {
    const result = await validate(root, { python: join(root, 'missing-python') });
    assert.equal(result.status, 'dependency_error');
    assert.match(result.failures.join(), /virtual environment/);
    assert.match(result.dependency.error, /ENOENT/);
  });

  it('reports a real missing PyYAML import without a validation-side install', async () => {
    const fake = join(root, 'python-without-site');
    const quotedPython = "'" + python.replaceAll("'", "'\\''") + "'";
    await put(root, 'python-without-site', '#!/bin/sh\nexec ' + quotedPython + ' -S "$@"\n');
    await chmod(fake, 0o755);
    const result = await validate(root, { python: fake });
    assert.equal(result.status, 'dependency_error');
    assert.match(result.dependency.stderr, /No module named 'yaml'/);
    assert.equal(result.upstream.skipped, true);
  });

  it('does not import Python code from the plugin or PYTHONPATH', async () => {
    await put(root, 'yaml.py', 'raise Exception("PLUGIN_CODE_EXECUTED")');
    await put(root, 'sitecustomize.py', 'raise Exception("PLUGIN_CODE_EXECUTED")');
    const result = spawnSync(
      process.execPath,
      [cli, 'validate', '--repo-root', root, '--python', python, '--json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONPATH: root } },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });

  it('does not discover repository scripts or environment-selected checks', async () => {
    await put(root, 'package.json', {
      scripts: { validate: 'exit 9' },
      codexTools: { repositoryChecks: [{ command: 'missing' }] },
    });
    assert.equal((await validate(root)).ok, true);
    assert.equal(
      parseArgs(['validate'], { CODEX_TOOLS_REPOSITORY_CHECKS: 'hostile.json' })
        .repositoryChecksPath,
      undefined,
    );
  });

  it('captures explicitly selected check diagnostics and failure status in clean JSON', async () => {
    await put(root, 'checks.json', [
      {
        name: 'owning policy',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("policy out"); process.stderr.write("policy err"); process.exit(7)',
        ],
      },
    ]);
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'validate',
        '--repo-root',
        root,
        '--python',
        python,
        '--repository-checks',
        'checks.json',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.upstream.ok, true);
    assert.equal(report.repository[0].exitCode, 7);
    assert.equal(report.repository[0].stdout, 'policy out');
    assert.equal(report.repository[0].stderr, 'policy err');
    assert.equal(result.stderr, '');
  });

  it('fails missing commands and malformed check descriptors', async () => {
    const result = await validate(root, {
      repositoryChecks: [{ name: 'missing', command: join(root, 'missing'), args: [] }],
    });
    assert.equal(result.ok, false);
    assert.match(result.repository[0].error, /ENOENT/);
    await assert.rejects(validate(root, { repositoryChecks: [{ name: 'bad' }] }), /name, command/);
  });

  it('keeps explicit program stdout and stderr separate in human output', async () => {
    await put(root, 'checks.json', [
      {
        name: 'streams',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("CHECK_STDOUT"); process.stderr.write("CHECK_STDERR"); process.exit(4)',
        ],
      },
    ]);
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'validate',
        '--repo-root',
        root,
        '--python',
        python,
        '--repository-checks',
        'checks.json',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /CHECK_STDOUT/);
    assert.doesNotMatch(result.stdout, /CHECK_STDERR/);
    assert.match(result.stderr, /CHECK_STDERR/);
  });

  it('propagates actual prompt-policy helper failures through repository integration', async () => {
    manifest.interface.defaultPrompt = ['Use $unknown-skill.'];
    await put(root, '.codex-plugin/plugin.json', manifest);
    const helper = new URL('../lib/repository-validation.js', import.meta.url).href;
    await put(
      root,
      'prompt-policy.mjs',
      [
        `import { validatePromptReferences } from ${JSON.stringify(helper)};`,
        `const result = validatePromptReferences({manifest: ${JSON.stringify(manifest)}, skillNames: ${JSON.stringify(names)}});`,
        'process.stderr.write(JSON.stringify(result.failures));',
        'process.exit(result.ok ? 0 : 1);',
      ].join('\n'),
    );
    const result = await validate(root, {
      repositoryChecks: [
        { name: 'prompt references', command: process.execPath, args: ['prompt-policy.mjs'] },
      ],
    });
    assert.equal(result.upstream.ok, true);
    assert.equal(result.ok, false);
    assert.match(result.repository[0].stderr, /unknown skill/);
  });

  it('runs every selected repository check and fails signaled programs', async () => {
    const result = await validate(root, {
      repositoryChecks: [
        { name: 'owning skills', command: process.execPath, args: ['-e', 'process.exit(3)'] },
        {
          name: 'automation',
          command: process.execPath,
          args: ['-e', 'process.kill(process.pid, "SIGTERM")'],
        },
        {
          name: 'model policy',
          command: process.execPath,
          args: ['-e', 'process.stdout.write("model checked")'],
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.repository.length, 3);
    assert.equal(result.repository[1].signal, 'SIGTERM');
    assert.equal(result.repository[2].stdout, 'model checked');
  });

  it('preserves repository-owned Markdown scope and workflow script checks', async () => {
    await put(
      root,
      'README.md',
      '[ok](assets/icon-large.png) [bad](missing.md) [external](https://example.com) [anchor](#a)',
    );
    await put(root, 'out-of-scope.md', '[bad](missing.md)');
    const links = await validateMarkdownLinks({ repoRoot: root, roots: ['README.md'] });
    assert.equal(links.failures.length, 1);
    await put(root, 'package.json', { scripts: { test: 'true' } });
    await put(root, '.github/workflows/test.yml', 'run: bun run test\nrun: npm run missing');
    const scripts = await validateWorkflowPackageScripts({ repoRoot: root });
    assert.equal(scripts.failures.length, 1);
    assert.match(scripts.failures[0], /missing/);
    await put(root, '.github/workflows/test.yml', 'run: bun run test');
    assert.equal((await validateWorkflowPackageScripts({ repoRoot: root })).ok, true);
  });

  it('rejects validation/cache option mixtures before effects', () => {
    for (const args of [
      ['validate', '--dry-run'],
      ['validate', '--cache-path', '/tmp/nope'],
      ['status', '--repository-checks', 'checks.json'],
    ])
      assert.throws(() => parseArgs(args, {}));
    assert.equal(
      parseArgs(['validate', '--python', '/explicit'], { CODEX_TOOLS_PYTHON: '/environment' })
        .python,
      '/explicit',
    );
    assert.equal(resolve(root), root);
  });
});
