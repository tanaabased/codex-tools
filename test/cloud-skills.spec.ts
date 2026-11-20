import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cloudProject } from '../lib/cloud-config.ts';
import { checkCloudSkill } from '../lib/cloud-check.ts';
import { packageCloudSkills } from '../lib/package-cloud-skills.ts';
import { parseArgs } from '../utils/parse-args.ts';

describe('cloud skills', () => {
  let root: string;
  const skill = 'skills/make';
  const config = skill + '/build.config.js';
  const marker = '<!-- packaged-execution -->';
  const body = '# make\n' + marker + '\n';
  async function file(name: string, text: string) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  async function settings(value: object, name = config) {
    await file(name, 'export default ' + JSON.stringify(value));
  }
  function track() {
    execFileSync('git', ['add', '.'], { cwd: root });
  }
  async function project(name = 'cloud.config.js') {
    return cloudProject(path.join(root, name));
  }
  async function pack(name?: string) {
    return packageCloudSkills(await project(name), process.env);
  }
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'cloud-test-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    await file('package.json', '{"name":"cloud-test","version":"1.0.0","type":"module"}');
    await settings(
      { skills: ['skills/*/SKILL.md', 'skills/make/*.md', '!skills/private/**'] },
      'cloud.config.js',
    );
    await file(skill + '/SKILL.md', body);
    await file(skill + '/scripts/run.js', "export {message} from '../../../shared.js';");
    await file('shared.js', "export const message='hello';");
    await file('skills/prose/SKILL.md', '# plain');
    await file('skills/private/SKILL.md', '[bad](missing.md)');
    await settings({ entrypoints: ['!scripts/omit.js', 'scripts/*.js'] });
    await file(skill + '/scripts/omit.js', 'throw Error()');
    track();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prefers an ancestor build config, then the closest cloud config, and honors explicit custom names', async () => {
    const cwd = process.cwd();
    await settings({ skills: 'skills/prose/SKILL.md' }, skill + '/scripts/cloud.config.js');
    await settings({}, skill + '/my-empty.mjs');
    await settings({ skills: 'skills/prose/SKILL.md' }, 'chosen.mjs');
    try {
      process.chdir(path.join(root, skill, 'scripts'));
      assert.deepEqual(
        (await cloudProject()).skills.map((s) => s.dir),
        [skill],
      );
      await rm(path.join(root, config));
      assert.deepEqual(
        (await cloudProject()).skills.map((s) => s.dir),
        ['skills/prose'],
      );
      assert.deepEqual((await project(skill + '/my-empty.mjs')).skills[0]?.entries, []);
      assert.deepEqual(
        (await project('chosen.mjs')).skills.map((s) => s.dir),
        ['skills/prose'],
      );
      await assert.rejects(project('typo.mjs'), /typo.mjs/);
      await rm(path.join(root, skill, 'scripts/cloud.config.js'));
      await rm(path.join(root, 'cloud.config.js'));
      await assert.rejects(cloudProject(), /No build.config.js or cloud.config.js/);
      assert.throws(() => parseArgs(['cloud', 'package', 'one.js', 'two.js']), /one config/);
      assert.throws(() => parseArgs(['cloud', 'verify']), /requires --package/);
    } finally {
      process.chdir(cwd);
    }
  });

  it('discovers unique tracked skills and keeps excluded skills and config-free prose untouched', async () => {
    const selected = await project();
    assert.deepEqual(
      selected.skills.map((s) => s.dir),
      [skill, 'skills/prose'],
    );
    assert.deepEqual(selected.skills[0]?.entries, ['scripts/run.js']);
    await file('skills/not-tracked/SKILL.md', '# other');
    assert.deepEqual(await pack(), [skill]);
    assert.equal(await readFile(path.join(root, 'skills/prose/SKILL.md'), 'utf8'), '# plain');
    assert.match(await readFile(path.join(root, skill + '/scripts/run.js'), 'utf8'), /hello/);
    assert.match(
      await readFile(path.join(root, skill + '/SKILL.md'), 'utf8'),
      /Packaged Command Execution/,
    );
  });

  it('preflights Bun before writing and rejects untracked local imports', async () => {
    const selected = await project();
    await assert.rejects(packageCloudSkills(selected, { PATH: '/nonexistent' }), /Bun.*PATH/);
    assert.equal(await readFile(path.join(root, skill + '/SKILL.md'), 'utf8'), body);
    await file('loose.js', 'export const loose=1');
    await file(skill + '/scripts/run.js', "export {loose} from '../../../loose.js'");
    await assert.rejects(pack(), /tracked.*loose.js/);
  });

  it('materializes tracked file and directory links first, then fills missing paths from copy globs', async () => {
    await settings({ copy: ['refs/**', '!refs/omit.md'] });
    await file('refs/style.md', 'common');
    await file('refs/added.md', 'added');
    await file('refs/omit.md', 'omitted');
    await file('team/style.md', 'chosen');
    await mkdir(path.join(root, skill, 'refs'));
    await symlink('../../../team/style.md', path.join(root, skill, 'refs/style.md'));
    await symlink('../../team', path.join(root, skill, 'team'));
    track();
    await file('team/local.md', 'untracked');
    const selected = await project();
    await packageCloudSkills(selected, { PATH: '/nonexistent' });
    const read = (f: string) => readFile(path.join(root, skill, f), 'utf8');
    assert.equal(await read('refs/style.md'), 'chosen');
    assert.equal(await read('team/style.md'), 'chosen');
    assert.ok((await lstat(path.join(root, skill, 'team'))).isDirectory());
    assert.equal(await read('refs/added.md'), 'added');
    for (const missing of ['refs/omit.md', 'team/local.md', 'runtime-files.json'])
      await assert.rejects(read(missing), { code: 'ENOENT' });
    assert.ok(!(await read('SKILL.md')).includes('packaged'));
  });

  it('rejects required unmaterialized, escaping and untracked links', async () => {
    await symlink('../../shared.js', path.join(root, skill, 'helper'));
    await settings({ symlinks: false });
    track();
    await assert.rejects(pack(), /enable symlinks/);
    const materialize = skill + '/materialize.mjs';
    await settings({}, materialize);
    await rm(path.join(root, skill, 'helper'));
    await symlink('../../../outside', path.join(root, skill, 'helper'));
    await assert.rejects(pack(materialize), /Invalid.*link/);
    await rm(path.join(root, skill, 'helper'));
    await file('loose.txt', 'untracked');
    await symlink('../../loose.txt', path.join(root, skill, 'helper'));
    await assert.rejects(pack(materialize), /tracked symlink target/);
  });

  it('enforces guidance on and off against the original marker', async () => {
    await settings({ guidance: 'on' });
    track();
    await assert.rejects(pack(), /requires a bundled command/);
    const on = skill + '/on.mjs';
    await settings({ guidance: 'on', entrypoints: 'scripts/run.js' }, on);
    await file(skill + '/SKILL.md', marker + '\n' + marker);
    track();
    await assert.rejects(pack(on), /exactly one/);
    await file(skill + '/SKILL.md', body);
    track();
    await pack(on);
    assert.match(
      await readFile(path.join(root, skill, 'SKILL.md'), 'utf8'),
      /Packaged Command Execution/,
    );
    await file(skill + '/SKILL.md', body);
    await settings({ guidance: 'off', entrypoints: 'scripts/run.js' }, skill + '/off.mjs');
    track();
    await pack(skill + '/off.mjs');
    assert.equal(
      await readFile(path.join(root, skill, 'SKILL.md'), 'utf8'),
      body.replace(marker, ''),
    );
  });

  it('checks transitive reader links, including cycles, from the linking document', async () => {
    await settings({});
    await file(skill + '/SKILL.md', '[guide][1]\n\n[1]: refs/start.md');
    await file(
      skill + '/refs/start.md',
      '[cycle](../SKILL.md)\n[external](https://example.com)\n[local](#head)',
    );
    track();
    await pack();
    for (const [link, repair] of [
      ['../../../shared.js', 'inside the skill'],
      ['./', 'concrete packaged file'],
      ['workflow.yml', 'workflow.yml.md'],
      ['gone.md', 'concrete packaged file'],
    ] as const) {
      await file(skill + '/refs/workflow.yml', 'key: value');
      await file(skill + '/refs/start.md', '[next](' + link + ')');
      await assert.rejects(
        pack(),
        (error: Error) =>
          error.message.includes(skill + '/refs/start.md') &&
          error.message.includes(link) &&
          error.message.includes(repair),
      );
    }
  });

  it('keeps declared icons and copied command templates valid for their own roles', async () => {
    await settings({ copy: 'templates/**' });
    await file('templates/raw.yml', 'key: value');
    await file('templates/packaged-command-execution.md', 'build only');
    await file(skill + '/agents/openai.yaml', 'interface:\n  icon_small: ./assets/icon.svg');
    await file(skill + '/assets/icon.svg', '<svg/>');
    track();
    await pack();
    assert.equal(await readFile(path.join(root, skill, 'templates/raw.yml'), 'utf8'), 'key: value');
    await assert.rejects(lstat(path.join(root, skill, 'templates/packaged-command-execution.md')), {
      code: 'ENOENT',
    });
    await rm(path.join(root, skill, 'assets/icon.svg'));
    const selected = await project();
    await assert.rejects(
      checkCloudSkill(selected, selected.skills[0]!, root),
      /agents\/openai.yaml.*icon.svg/,
    );
  });

  it('checks the extracted command inventory, bytes and original guidance independently', async () => {
    await pack();
    const artifact = path.join(root, 'artifact');
    await cp(path.join(root, 'skills'), path.join(artifact, 'skills'), { recursive: true });
    const selected = await project();
    const check = () => checkCloudSkill(selected, selected.skills[0]!, artifact);
    await check();
    const inventoryFile = 'artifact/' + skill + '/runtime-files.json';
    const original = await readFile(path.join(root, inventoryFile), 'utf8');
    await file(inventoryFile, JSON.stringify({ ...JSON.parse(original), commands: [] }));
    await assert.rejects(check(), /tracked entrypoints/);
    await file(inventoryFile, original);
    const command = 'artifact/' + skill + '/scripts/run.js';
    const bytes = await readFile(path.join(root, command));
    await writeFile(path.join(root, command), Buffer.alloc(bytes.length));
    await assert.rejects(check(), /SHA-256/);
    await writeFile(path.join(root, command), bytes);
    await file('artifact/' + skill + '/SKILL.md', '# missing guidance');
    await assert.rejects(check(), /guidance/);
    await rm(path.join(artifact, 'skills/prose/SKILL.md'));
    await assert.rejects(checkCloudSkill(selected, selected.skills[1]!, artifact), /SKILL.md/);
  });
});
