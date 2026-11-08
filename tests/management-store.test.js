import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { SkillStore, skillId } from '../src/store.js';

const NOW = '2026-11-08T00:00:00.000Z';
const SINCE = '2026-10-01T00:00:00.000Z';
const actor = { kind: 'user', label: 'Owner UI' };
const summary = { name: 'journal-fixture', provider: 'filesystem', source: 'custom', description: 'Metadata only', path: '/fixture/journal-fixture/SKILL.md' };
const id = skillId(summary), alias = 'f'.repeat(64);
const plain = rows => rows.map(row => ({ ...row }));
const conflict = error => error.code === 'conflict' && error.status === 409;

async function ownedDatabase(t) {
  const root = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(root, 'dsh-management-store-')));
  const verify = () => {
    assert.ok(isAbsolute(directory));
    assert.equal(resolve(directory), directory);
    assert.equal(join(root, basename(directory)), directory);
    assert.ok(basename(directory).startsWith('dsh-management-store-'));
    assert.ok(directory.startsWith(root + sep));
  };
  verify();
  t.after(async () => { verify(); assert.equal(await realpath(directory), directory); await rm(directory, { recursive: true, force: true }); });
  return join(directory, 'fixture.sqlite');
}
function open(t, filename = ':memory:') {
  const store = new SkillStore(filename, { now: () => NOW });
  t.after(() => store.close());
  return store;
}
function observe(store) {
  store.observe([{ contextId: 'fixture', cwd: '/fixture', complete: true, skills: [{ ...summary, file: { status: 'present', version: 'revision-1', contentHash: 'a'.repeat(64) } }] }]);
}
function pending(operationId = 'operation-one') {
  return { version: 1, pending: { operationId, phase: 'intent', action: 'disable' }, lastOperation: { id: operationId, action: 'disable', status: 'running', at: NOW } };
}
function tables(db) {
  return Object.fromEntries(['meta', 'skills', 'availability', 'events', 'invocations', 'skill_aliases'].map(table => [table, plain(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())]));
}

// Independently authored v2 fixture: upgrading must not rewrite identity, observations or call keys.
function seedV2(filename) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE availability (skill_id TEXT NOT NULL REFERENCES skills(id), context_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(skill_id,context_id));
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, skill_id TEXT NOT NULL REFERENCES skills(id), kind TEXT NOT NULL, at TEXT NOT NULL, actor TEXT, details TEXT NOT NULL);
      CREATE TABLE invocations (event_key TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id), at TEXT NOT NULL, actor TEXT NOT NULL, outcome TEXT NOT NULL, channel TEXT NOT NULL);
      CREATE TABLE skill_aliases (alias TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id));
      PRAGMA user_version=2;
    `);
    db.prepare('INSERT INTO meta VALUES (?,?)').run('since', SINCE);
    db.prepare('INSERT INTO meta VALUES (?,?)').run('fixture-note', 'preserve verbatim');
    db.prepare('INSERT INTO skills VALUES (?,?)').run(id, JSON.stringify({ ...summary, id, status: 'present', firstSeenAt: SINCE, lastSeenAt: NOW, fileVersion: 'revision-1' }));
    db.prepare('INSERT INTO availability VALUES (?,?,?)').run(id, 'fixture', JSON.stringify({ contextId: 'fixture', effective: true, source: 'custom', cwd: '/fixture' }));
    db.prepare('INSERT INTO skill_aliases VALUES (?,?)').run(alias, id);
    const key = 'skill:fixture-session:original-call-key';
    db.prepare('INSERT INTO invocations VALUES (?,?,?,?,?,?)').run(key, id, NOW, JSON.stringify(actor), 'success', 'tool');
    db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(41, key, id, 'invocation', NOW, JSON.stringify(actor), JSON.stringify({ outcome: 'success', channel: 'tool' }));
    return tables(db);
  } finally { db.close(); }
}

test('v2 to v3 upgrade adds only the journal and preserves IDs, aliases, metadata, history and deduplication', async t => {
  const filename = await ownedDatabase(t), before = seedV2(filename), store = open(t, filename);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(tables(store.db), before);
  assert.deepEqual(store.listControls(), []);
  assert.equal(store.canonicalId(alias), id);
  assert.equal(store.since(), SINCE);
  assert.equal(store.detail(alias).events[0].id, 41);
  assert.equal(store.snapshot()[0].usage.total, 1);
  assert.equal(store.invocation({ eventKey: 'skill:fixture-session:original-call-key' }), false);
  assert.deepEqual(plain(store.db.prepare('PRAGMA foreign_key_check').all()), []);
});

test('control and audit commit together through aliases and survive reopen without bodies or confirmation tokens', async t => {
  const filename = await ownedDatabase(t);
  seedV2(filename);
  let store = new SkillStore(filename, { now: () => NOW });
  try {
    const control = pending();
    store.saveControl(alias, control, 'action-intent', { action: 'disable', operationId: 'operation-one' }, actor, {});
    assert.deepEqual(store.getControl(id), control);
    assert.deepEqual(store.getControl(alias), control);
    assert.deepEqual(store.listControls(), [{ id, control }]);
    const event = store.detail(alias).events[0];
    assert.equal(event.kind, 'action-intent');
    assert.deepEqual(event.actor, actor);
    assert.deepEqual(event.details, { action: 'disable', operationId: 'operation-one' });
    control.pending.phase = 'caller-tamper';
    assert.equal(store.getControl(id).pending.phase, 'intent');
    store.close();
    store = new SkillStore(filename, { now: () => NOW });
    assert.equal(store.getControl(alias).pending.operationId, 'operation-one');
    assert.equal(store.detail(id).total, 2);
    assert.equal(store.snapshot()[0].usage.total, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM file_controls').get().n, 1);
    const persisted = JSON.stringify({ tables: tables(store.db), controls: store.listControls() });
    assert.ok(!persisted.includes('confirmationText'));
    assert.ok(!persisted.includes('"token"'));
    assert.ok(!persisted.includes('instructionBody'));
  } finally { store.close(); }
});

test('serialization failures roll back both a new journal and replacement of an existing journal', t => {
  const store = open(t); observe(store);
  const original = { version: 1, lastOperation: { id: 'previous', status: 'succeeded' } };
  const circular = {}; circular.self = circular;
  const before = store.detail(id).total;
  assert.throws(() => store.saveControl(id, pending(), 'action-intent', circular, actor), /circular/i);
  assert.equal(store.getControl(id), null);
  assert.equal(store.detail(id).total, before);
  store.saveControl(id, original, 'action-completed', {});
  assert.throws(() => store.saveControl(id, pending(), 'action-intent', { impossible: 1n }, actor), /BigInt/i);
  assert.deepEqual(store.getControl(id), original);
  assert.equal(store.detail(id).total, before + 1);
  assert.throws(() => store.saveControl(id, { circular }, 'action-intent'));
  assert.deepEqual(store.getControl(id), original);
  // A successful write proves the failed transaction did not leave a transaction open.
  store.saveControl(id, pending(), 'action-intent', {}, actor, original);
  assert.equal(store.getControl(id).pending.phase, 'intent');
});

test('journal event SQL failure rolls back the already-issued control write', t => {
  const store = open(t); observe(store);
  store.db.exec("CREATE TRIGGER reject_fixture_audit BEFORE INSERT ON events WHEN NEW.kind='action-intent' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
  const before = store.detail(id).total;
  assert.throws(() => store.saveControl(id, pending(), 'action-intent'), /fixture audit failure/);
  assert.equal(store.getControl(id), null);
  assert.equal(store.detail(id).total, before);
  store.db.exec('DROP TRIGGER reject_fixture_audit');
  store.saveControl(id, pending(), 'action-intent');
  assert.equal(store.detail(id).total, before + 1);
});

test('unknown identities and foreign keys cannot create orphan journals or remove journal owners', t => {
  const store = open(t); observe(store);
  assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.throws(() => store.saveControl('0'.repeat(64), pending(), 'action-intent'), /Unknown skill/);
  assert.throws(() => store.db.prepare('INSERT INTO file_controls VALUES (?,?)').run('0'.repeat(64), '{}'), /FOREIGN KEY/);
  assert.deepEqual(store.listControls(), []);
  store.saveControl(id, pending(), 'action-intent');
  assert.throws(() => store.db.prepare('DELETE FROM skills WHERE id=?').run(id), /FOREIGN KEY/);
  assert.deepEqual(plain(store.db.prepare('PRAGMA foreign_key_check').all()), []);
});

test('expectedControl is checked before admission and failed CAS writes no audit', t => {
  const store = open(t); observe(store);
  store.saveControl(id, pending(), 'action-intent', {}, actor, {});
  const before = store.detail(id).total;
  assert.throws(() => store.saveControl(id, pending('operation-two'), 'action-intent', {}, actor, {}), conflict);
  assert.deepEqual(store.getControl(id), pending());
  assert.equal(store.detail(id).total, before);
});

test('two SQLite connections cannot replace or clear another pending owner; rightful progress and completion succeed', async t => {
  const filename = await ownedDatabase(t), first = open(t, filename); observe(first);
  const second = open(t, filename), stale = second.getControl(id) ?? {};
  first.saveControl(id, pending(), 'action-intent', {}, actor, {});
  const before = first.detail(id).total;
  assert.throws(() => second.saveControl(id, pending('operation-two'), 'action-intent', {}, actor, stale), conflict);
  for (const candidate of [
    pending('operation-two'),
    {},
    { version: 1, lastOperation: { id: 'operation-two', status: 'succeeded' } },
    { ...pending(), lastOperation: { id: 'operation-two', status: 'running' } },
    { ...pending('operation-two'), lastOperation: { id: 'operation-one', status: 'running' } },
  ]) assert.throws(() => second.saveControl(id, candidate, 'action-phase'), conflict);
  assert.equal(first.detail(id).total, before);
  assert.deepEqual(second.getControl(id), pending());
  const progress = pending(); progress.pending.phase = 'claimed';
  second.saveControl(id, progress, 'action-phase', { phase: 'claimed' }, actor, pending());
  assert.deepEqual(first.getControl(id), progress);
  const completed = { version: 1, lastOperation: { id: 'operation-one', status: 'succeeded', action: 'disable', at: NOW } };
  first.saveControl(id, completed, 'action-completed', {}, actor, progress);
  assert.deepEqual(second.getControl(id), completed);
  second.saveControl(id, pending('operation-two'), 'action-intent', {}, actor, completed);
  assert.equal(first.getControl(id).pending.operationId, 'operation-two');
  assert.equal(first.detail(id).total, before + 3);
});
