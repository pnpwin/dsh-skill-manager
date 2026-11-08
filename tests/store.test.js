import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SkillStore, skillId } from '../src/store.js';
import { probeFile } from '../src/file-probe.js';

const NOW = '2026-11-08T00:00:00.000Z';
const summary = { name: 'example', provider: 'filesystem', source: 'project-dsh', description: 'Example', path: '/project/.dsh/skills/example/SKILL.md' };
const actor = { kind: 'agent', id: 'agent-1', sessionId: 'agent-1', label: 'Agent 1' };
function memory(t) { const store = new SkillStore(':memory:', { now: () => NOW }); t.after(() => store.close()); return store; }
const observe = (store, skills, complete = true, contextId = 'project') => store.observe([{ contextId, cwd: '/project', skills, complete }]);
const file = (hash, version = hash) => ({ status: 'present', createdAt: '2026-10-01T00:00:00.000Z', modifiedAt: NOW, contentHash: hash, version });
const invoke = (store, at, key, extra = {}) => store.invocation({ eventKey: key, name: 'example', provider: 'filesystem', at, actor, outcome: 'success', channel: 'tool', ...extra });

test('instance identities distinguish provider and location but never scope', () => {
  assert.equal(skillId(summary, 'a'), skillId(summary, 'b'));
  assert.notEqual(skillId(summary, 'a'), skillId({ ...summary, path: '/different' }, 'a'));
  assert.notEqual(skillId(summary, 'a'), skillId({ ...summary, provider: 'other' }, 'a'));
  assert.equal(skillId({ ...summary, path: null }, 'a'), skillId({ ...summary, path: null }, 'b'));
});

test('creation evidence stays distinct from first observation and unknown authors', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  const row = store.snapshot()[0];
  assert.equal(row.createdEvidence, 'filesystem-birthtime');
  assert.equal(row.firstSeenAt, NOW);
  assert.notEqual(row.createdAt, row.firstSeenAt);
  assert.equal(row.createdBy, null);
  assert.equal(row.modifiedBy, null);
  assert.equal(store.detail(row.id).events[0].kind, 'discovered');
  assert.equal(row.usage.total, 0);
});

test('catalog absence is availability loss, not proof of physical deletion', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  observe(store, []);
  let row = store.snapshot()[0];
  assert.equal(row.status, 'present');
  assert.equal(row.availability[0].effective, false);
  store.physical(row.id, { status: 'missing' });
  row = store.snapshot()[0];
  assert.equal(row.status, 'missing');
  observe(store, [{ ...summary, file: file('a') }]);
  assert.equal(store.snapshot()[0].id, row.id);
  assert.ok(store.detail(row.id).events.some(event => event.kind === 'restored'));
});

test('incomplete observations preserve prior membership and virtual disappearance is unavailable', t => {
  const store = memory(t);
  observe(store, [{ ...summary, path: null }]);
  observe(store, [], false);
  assert.equal(store.snapshot()[0].availability[0].effective, true);
  observe(store, []);
  store.reconcileContexts(['project']);
  assert.equal(store.snapshot()[0].status, 'unavailable');
});

test('hash revisions preserve a writer only for an exactly matching filesystem version', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  const id = store.snapshot()[0].id;
  store.mutation({ eventKey: 'write-1', path: summary.path, at: NOW, actor, observation: { kind: 'present', version: 'b' } });
  assert.equal(store.snapshot()[0].modifiedBy, null);
  observe(store, [{ ...summary, file: file('b') }]);
  assert.deepEqual(store.snapshot()[0].modifiedBy, actor);
  store.physical(id, file('c'));
  assert.equal(store.snapshot()[0].modifiedBy, null);
  assert.equal(store.detail(id).events.filter(event => event.kind === 'modified').length, 2);
  store.mutation({ eventKey: 'write-1', path: summary.path, at: NOW, actor, observation: { kind: 'present', version: 'b' } });
  assert.equal(store.detail(id).events.filter(event => event.kind === 'mutation').length, 1);
});

test('a changed oversized revision clears obsolete hashes and records qualified metadata evidence', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  const id = store.snapshot()[0].id;
  store.physical(id, { ...file(null, 'b'), warning: 'instruction-file-too-large' });
  assert.equal(store.snapshot()[0].contentHash, null);
  assert.equal(store.detail(id).events[0].details.evidence, 'filesystem-version');
  observe(store, [{ ...summary, file: file('c') }]);
  observe(store, [{ ...summary, file: file(null, 'd') }]);
  assert.equal(store.snapshot()[0].contentHash, null);
});

test('rolling windows include exact bounds, attempts include errors, event keys deduplicate', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  for (const [index, at] of ['2026-10-30T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-06T23:59:59.999Z', '2026-11-07T00:00:00.000Z', NOW].entries()) invoke(store, at, `call-${index}`, index === 4 ? { outcome: 'error', channel: 'ptc' } : {});
  assert.equal(invoke(store, NOW, 'call-4'), false);
  const { usage } = store.snapshot()[0];
  assert.equal(usage.total, 5);
  assert.equal(usage.count7d, 4);
  assert.equal(usage.count24h, 2);
  assert.equal(usage.lastAt, NOW);
  assert.deepEqual(usage.lastActor, actor);
});

test('ambiguous same-name invocations remain separate unresolved observations', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }, { ...summary, path: '/other/example.md', file: file('b') }]);
  invoke(store, NOW, 'ambiguous');
  assert.equal(store.snapshot().length, 3);
  assert.equal(store.snapshot().find(row => row.source === 'unknown').usage.total, 1);
  assert.equal(store.snapshot().filter(row => row.source !== 'unknown').reduce((n, row) => n + row.usage.total, 0), 0);
});

test('a failed lookup cannot be assigned to a name visible only in another context', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }], true, 'other-context');
  invoke(store, NOW, 'wrong-scope', { contextId: 'this-context', outcome: 'error' });
  assert.equal(store.snapshot().find(row => row.source === 'project-dsh').usage.total, 0);
  assert.equal(store.snapshot().find(row => row.source === 'unknown').usage.total, 1);
});

test('history pagination rejects invalid input and snapshots do not share stored object references', t => {
  const store = memory(t);
  observe(store, [{ ...summary, file: file('a') }]);
  const row = store.snapshot()[0];
  row.name = 'changed';
  assert.equal(store.snapshot()[0].name, 'example');
  assert.throws(() => store.detail(row.id, { offset: -1 }));
  assert.throws(() => store.detail(row.id, { limit: 0 }));
  assert.equal(store.detail('unknown'), null);
});

async function ownedDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-test-'));
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + '/') && absolute.includes('dsh-skill-manager-test-'));
  t.after(() => rm(absolute, { recursive: true, force: true }));
  return directory;
}

test('SQLite persists tombstones, deduplication and usage across reopen', async t => {
  const directory = await ownedDirectory(t), filename = join(directory, 'skills.sqlite');
  let store = new SkillStore(filename, { now: () => NOW });
  observe(store, [{ ...summary, file: file('a') }]);
  invoke(store, NOW, 'call-1');
  const id = store.snapshot()[0].id;
  store.physical(id, { status: 'missing' }); store.close();
  store = new SkillStore(filename, { now: () => NOW });
  try {
    assert.equal(store.snapshot()[0].status, 'missing');
    assert.equal(invoke(store, NOW, 'call-1'), false);
    assert.equal(store.snapshot()[0].usage.total, 1);
    assert.equal(store.since(), NOW);
  } finally { store.close(); }
});

test('file probe hashes only bounded regular files, reports genuine absence and stable DSH tokens', async t => {
  const directory = await ownedDirectory(t), path = join(directory, 'SKILL.md');
  await writeFile(path, 'instructions');
  const present = await probeFile(path);
  assert.equal(present.status, 'present');
  assert.match(present.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(present.version.split(':').length, 5);
  assert.equal((await probeFile(path, { maxFileBytes: 2 })).warning, 'instruction-file-too-large');
  await mkdir(join(directory, 'not-file'));
  assert.equal((await probeFile(join(directory, 'not-file'))).status, 'unknown');
  // This exact temporary file was created above and is the intended deletion target.
  assert.equal(resolve(path), join(resolve(directory), 'SKILL.md'));
  await unlink(path);
  assert.equal((await probeFile(path)).status, 'missing');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(probeFile(path, { signal: abort.signal }));
});
