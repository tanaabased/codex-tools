import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { freshSkills } from '../fresh-skills.ts';

const cwd = '/disposable/plugin-consumer';
const expected = [
  'codex-tools:tanaab-codex-tools-setup',
  'codex-tools:tanaab-codex-tools-maintenance',
];
const skills = expected.map((name) => ({ name, enabled: true }));
const result = (records: unknown = skills) => ({ data: [{ cwd, skills: records, errors: [] }] });

function server(reply: unknown, initialize: unknown = { id: 1, result: {} }) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      stopped = true;
      return true;
    },
  });
  let stopped = false;
  const requests: Array<{ id?: number; method: string; params?: unknown }> = [];
  child.stdin.on('data', (chunk) => {
    const request = JSON.parse(String(chunk)) as (typeof requests)[number];
    requests.push(request);
    if (request.id) {
      queueMicrotask(() => {
        const response = request.id === 1 ? initialize : reply;
        const line = typeof response === 'string' ? response : JSON.stringify(response);
        // fragmented lines exercise the process boundary without spawning codex.
        child.stdout.write(line.slice(0, 5));
        child.stdout.write(line.slice(5) + '\n');
      });
    }
  });
  return { child, requests, stopped: () => stopped };
}

describe('examples/.fixtures/fresh-skills', () => {
  it('should verify exact enabled skills in the requested directory', async () => {
    const fake = server({ id: 2, result: result() });
    await freshSkills({}, cwd, expected, () => fake.child);
    assert.deepEqual(
      fake.requests.map((request) => request.method),
      ['initialize', 'initialized', 'skills/list'],
    );
    assert.deepEqual(fake.requests[2]?.params, { cwds: [cwd], forceReload: true });
    assert.equal(fake.stopped(), true);
  });

  for (const [label, payload] of [
    ['missing skills', result([])],
    [
      'names appearing only in errors',
      {
        data: [
          {
            cwd,
            skills: [],
            errors: expected.map((name) => ({
              path: `/${name}/SKILL.md`,
              message: `failed to load ${name}`,
            })),
          },
        ],
      },
    ],
    [
      'partial name matches',
      result(expected.map((name) => ({ name: name + '-other', enabled: true }))),
    ],
    ['disabled skills', result(expected.map((name) => ({ name, enabled: false })))],
    [
      'another plugin',
      result(
        expected.map((name) => ({ name: name.replace('codex-tools:', 'other:'), enabled: true })),
      ),
    ],
    ['another directory', { data: [{ cwd: '/other', skills, errors: [] }] }],
    ['ambiguous directory entries', { data: [...result().data, ...result().data] }],
    ['missing data', {}],
    ['non-array data', { data: {} }],
    ['non-array skills', result({})],
    ['invalid skill records', result([null])],
    ['missing enablement', result(expected.map((name) => ({ name })))],
  ] as const) {
    it('should reject ' + label, async () => {
      const fake = server({ id: 2, result: payload });
      await assert.rejects(
        freshSkills({}, cwd, expected, () => fake.child),
        /Fresh-session|Malformed fresh-session/,
      );
      assert.equal(fake.stopped(), true);
    });
  }

  for (const [label, reply, initialize] of [
    ['initialization errors', undefined, { id: 1, error: { code: -32603, message: 'failed' } }],
    ['discovery errors', { id: 2, error: { code: -32603, message: 'failed' } }, undefined],
    ['missing results', { id: 2 }, undefined],
    ['null results', { id: 2, result: null }, undefined],
    ['malformed JSON', '{', undefined],
  ] as const) {
    it('should reject ' + label + ' without an uncaught handler error', async () => {
      const fake = server(reply, initialize);
      await assert.rejects(
        freshSkills({}, cwd, expected, () => fake.child),
        /app-server/,
      );
      assert.equal(fake.stopped(), true);
    });
  }

  it('should reject early process exit without waiting for the deadline', async () => {
    const fake = server({ id: 2, result: result() });
    const pending = freshSkills({}, cwd, expected, () => fake.child);
    fake.child.emit('close', 1, null);
    await assert.rejects(pending, /exited before discovery/);
    assert.equal(fake.stopped(), true);
  });
});
