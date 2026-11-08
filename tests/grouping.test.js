import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSkillInstances } from '../src/grouping.js';
import { SkillStore } from '../src/store.js';
const actor = { kind: 'agent', label: 'Fixture', sessionId: 'fixture' };
function instance(id, extra = {}) {
  return { id, name: 'code-review', provider: 'filesystem', source: 'custom', description: 'Review code', path: `/fixture/${id}/SKILL.md`, status: 'present', contentHash: null, availability: [], modifiedAt: null,
    usage: { count24h: 1, count7d: 2, total: 3, lastAt: null, lastActor: null }, ...extra };
}

test('same names become a single presentation group, but locations and providers remain instances', () => {
  const a = instance('a'), b = instance('b', { source: 'project-dsh' }), c = instance('c', { provider: 'packaged' });
  const groups = groupSkillInstances([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].instanceCount, 3);
  assert.deepEqual(groups[0].instanceIds, ['a', 'b', 'c']);
  assert.deepEqual(groups[0].sources, ['custom', 'project-dsh']);
  assert.deepEqual(groups[0].providers, ['filesystem', 'packaged']);
  assert.equal(groups[0].metadataDiffers, true);
  assert.equal(groups[0].usage.total, 9);
  assert.equal(groups[0].usage.count24h, 3);
  assert.equal(groups[0].usage.count7d, 6);
});

test('only positive current file hashes establish identical copies, never equal names or nulls', () => {
  const groups = groupSkillInstances([instance('a', { contentHash: 'same' }), instance('b', { contentHash: 'same' }),
    instance('c'), instance('d'), instance('e', { contentHash: 'different' }), instance('f', { contentHash: 'same', status: 'missing' }), instance('g', { path: null, contentHash: 'same' })]);
  assert.deepEqual(groups[0].identicalCopies, [{ contentHash: 'same', instanceIds: ['a', 'b'] }]);
  assert.equal(groups[0].status, 'mixed');
  assert.deepEqual(groups[0].statuses, ['missing', 'present']);
});

test('group latest use and actor follow timestamps, ordering is deterministic and input is not mutated', () => {
  const a = instance('b', { modifiedAt: '2026-01-01T00:00:00.000Z', usage: { count24h: 0, count7d: 0, total: 1, lastAt: '2026-01-01T00:00:00.000Z', lastActor: { ...actor, label: 'Earlier' } } });
  const b = instance('a', { modifiedAt: '2026-01-02T00:00:00.000Z', usage: { count24h: 0, count7d: 0, total: 1, lastAt: '2026-01-02T00:00:00.000Z', lastActor: actor } });
  const before = structuredClone([a, b]);
  const groups = groupSkillInstances([a, b]);
  assert.deepEqual(groups, groupSkillInstances([b, a]));
  assert.equal(groups[0].usage.lastActor, actor);
  assert.equal(groups[0].modifiedAt, b.modifiedAt);
  assert.deepEqual([a, b], before);
});

test('scope metadata remains visible without duplicating an instance or counting its usage twice', () => {
  const shared = instance('shared', { path: null, availability: [
    { contextId: 'a', effective: true, source: 'runtime', description: 'Scoped description', invocation: { modelInvocable: false, userInvocable: true } },
    { contextId: 'b', effective: false, source: 'retired', description: 'Inactive scope' },
  ] });
  const [group] = groupSkillInstances([shared, shared]);
  assert.equal(group.instanceCount, 1);
  assert.equal(group.usage.total, 3);
  assert.equal(group.metadataDiffers, true);
  assert.deepEqual(group.sources, ['custom', 'runtime']);
});

test('names are presentation keys only: distinct names are never merged by hash', () => {
  const groups = groupSkillInstances([instance('a', { name: 'a', contentHash: 'same' }), instance('b', { name: 'b', contentHash: 'same' })]);
  assert.deepEqual(groups.map(group => group.name), ['a', 'b']);
  assert.ok(groups.every(group => group.instanceCount === 1 && group.identicalCopies.length === 0));
});

test('scope churn and retry observations do not inflate group counters through the real store', t => {
  const now = '2026-11-08T00:00:00.000Z';
  const store = new SkillStore(':memory:', { now: () => now }); t.after(() => store.close());
  const summary = { name: 'code-review', provider: 'bundled', source: 'runtime', description: 'Virtual', resourceBase: { kind: 'opaque', description: 'Managed resources' } };
  store.observe(['session-a', 'session-b', 'preset'].map(contextId => ({ contextId, complete: true, skills: [summary] })));
  for (const contextId of ['session-a', 'session-b']) store.invocation({ eventKey: `skill:${contextId}:call-1`, name: 'code-review', provider: 'bundled', resourceBase: summary.resourceBase, contextId, actor, at: now, outcome: 'success', channel: 'tool' });
  store.invocation({ eventKey: 'skill:session-a:call-1', name: 'code-review', provider: 'bundled', contextId: 'session-a', actor, at: now, outcome: 'success', channel: 'tool' });
  const snapshot = store.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].availability.length, 3);
  assert.equal(groupSkillInstances(snapshot)[0].usage.total, 2);
});
