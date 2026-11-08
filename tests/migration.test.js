import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SkillStore, skillId } from '../src/store.js';

// Independent v1 fixture: never create legacy rows with the implementation under test.
const V1_SCHEMA = `
  PRAGMA foreign_keys=ON;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE availability (skill_id TEXT NOT NULL REFERENCES skills(id), context_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(skill_id,context_id));
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, skill_id TEXT NOT NULL REFERENCES skills(id), kind TEXT NOT NULL, at TEXT NOT NULL, actor TEXT, details TEXT NOT NULL);
  CREATE INDEX events_skill_time ON events(skill_id,at DESC,id DESC);
  CREATE TABLE invocations (event_key TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id), at TEXT NOT NULL, actor TEXT NOT NULL, outcome TEXT NOT NULL, channel TEXT NOT NULL);
  CREATE INDEX invocation_skill_time ON invocations(skill_id,at DESC,event_key);
  PRAGMA user_version=1;
`;
const NOW = '2026-11-08T00:00:00.000Z';
const SINCE = '2026-10-01T01:02:03.000Z';
const EARLY = '2026-10-20T00:00:00.000Z';
const MIDDLE = '2026-11-05T00:00:00.000Z';
const LATEST = '2026-11-07T23:00:00.000Z';
const actor = { kind: 'agent', id: 'fixture-agent', sessionId: 'fixture-agent', label: 'Fixture agent' };
const baseSummary = { name: 'example', provider: 'packaged-provider', source: 'bundled', description: 'Example', path: null,
  invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: '/fixture/package/skills/example' } };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyId = (skill, contextId) => digest([skill.provider, skill.name,
  skill.path ? ['file', resolve(skill.path)] : ['virtual', contextId, skill.resourceBase ?? null]]);
function canonicalBase(base) {
  if (!base) return null;
  if (base.kind === 'directory') return { kind: 'directory', path: resolve(base.path) };
  if (base.kind === 'url') return { kind: 'url', url: base.url };
  if (base.kind === 'opaque') return { kind: 'opaque', description: base.description };
  throw new Error('fixture uses only the public resource-base union');
}
const expectedId = skill => digest([skill.provider, skill.name, skill.path ? ['file', resolve(skill.path)]
  : [skill.source === 'unknown' ? 'unresolved' : 'virtual', canonicalBase(skill.resourceBase)]]);
const plainRows = rows => rows.map(row => ({ ...row }));

async function ownedDatabase(t) {
  const directory = resolve(await mkdtemp(join(tmpdir(), 'dsh-skill-migration-')));
  assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
  assert.ok(directory.includes('dsh-skill-migration-'));
  t.after(async () => {
    // This exact unique directory was created above and is owned by this test.
    assert.equal(resolve(directory), directory);
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep) && directory.includes('dsh-skill-migration-'));
    await rm(directory, { recursive: true, force: true });
  });
  return join(directory, 'fixture.sqlite');
}
function seed(filename, entries) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(V1_SCHEMA);
    db.prepare('INSERT INTO meta VALUES (?,?)').run('since', SINCE);
    db.prepare('INSERT INTO meta VALUES (?,?)').run('fixture-note', 'preserve metadata verbatim');
    for (const [index, entry] of entries.entries()) {
      const contextId = entry.contextId ?? `context-${index}`;
      const skill = { ...baseSummary, ...entry.skill };
      const id = legacyId(skill, contextId);
      const row = { ...skill, id, status: entry.status ?? 'present', firstSeenAt: entry.firstSeenAt ?? EARLY,
        lastSeenAt: entry.lastSeenAt ?? LATEST, createdAt: null, createdEvidence: 'unknown', createdBy: null,
        modifiedAt: null, modifiedBy: null, contentHash: null, fileVersion: null };
      db.prepare('INSERT INTO skills VALUES (?,?)').run(id, JSON.stringify(row));
      const memberships = entry.memberships ?? [{ contextId, cwd: '/fixture/workspace', effective: true }];
      for (const membership of memberships) db.prepare('INSERT INTO availability VALUES (?,?,?)').run(id, membership.contextId, JSON.stringify(membership));
      db.prepare('INSERT INTO events(id,event_key,skill_id,kind,at,actor,details) VALUES (?,?,?,?,?,?,?)')
        .run(10 + index * 2, `discover-${index}`, id, 'discovered', row.firstSeenAt, null, JSON.stringify({ fixture: index, evidence: 'catalog-observation' }));
      const at = entry.callAt ?? row.lastSeenAt;
      const outcome = index % 2 === 0 ? 'success' : 'error';
      const channel = index % 2 === 0 ? 'tool' : 'ptc';
      const eventKey = `skill:fixture-session:call-${index}`;
      db.prepare('INSERT INTO invocations VALUES (?,?,?,?,?,?)').run(eventKey, id, at, JSON.stringify(actor), outcome, channel);
      db.prepare('INSERT INTO events(id,event_key,skill_id,kind,at,actor,details) VALUES (?,?,?,?,?,?,?)')
        .run(11 + index * 2, eventKey, id, 'invocation', at, JSON.stringify(actor), JSON.stringify({ outcome, channel, fixture: index }));
    }
    return {
      skills: plainRows(db.prepare('SELECT * FROM skills ORDER BY id').all()),
      availability: plainRows(db.prepare('SELECT * FROM availability ORDER BY skill_id,context_id').all()),
      events: plainRows(db.prepare('SELECT * FROM events ORDER BY id').all()),
      invocations: plainRows(db.prepare('SELECT * FROM invocations ORDER BY event_key').all()),
      meta: plainRows(db.prepare('SELECT * FROM meta ORDER BY key').all()),
    };
  } finally { db.close(); }
}
function readFixture(filename, read) {
  const db = new DatabaseSync(filename);
  try { return read(db); } finally { db.close(); }
}
function open(t, filename) {
  const store = new SkillStore(filename, { now: () => NOW });
  t.after(() => store.close());
  return store;
}
function withoutSkillId(rows) { return rows.map(({ skill_id, ...row }) => row); }

for (const [label, resourceBase] of [
  ['directory', { kind: 'directory', path: '/fixture/package/skills/example' }],
  ['url', { kind: 'url', url: 'https://example.invalid/skills/example/' }],
  ['opaque', { kind: 'opaque', description: 'Provider-owned resources' }],
  ['none', undefined],
]) {
  test(`canonical virtual ${label} identity ignores all legacy scope arguments`, () => {
    const skill = { ...baseSummary, resourceBase };
    assert.equal(skillId(skill), expectedId(skill));
    assert.equal(skillId(skill, 'host'), skillId(skill, 'preset-standard'));
    assert.equal(skillId(skill, 'preset-standard'), skillId(skill, 'agent-restarted'));
  });
}

test('canonical resource-base serialization projects known fields in stable order', () => {
  const forms = [
    [{ path: '/fixture/package/../package/skills/example', kind: 'directory', extra: true }, { kind: 'directory', path: '/fixture/package/skills/example' }],
    [{ url: 'https://example.invalid/skills/example/', kind: 'url', extra: true }, { kind: 'url', url: 'https://example.invalid/skills/example/' }],
    [{ description: 'Provider-owned resources', kind: 'opaque', extra: true }, { kind: 'opaque', description: 'Provider-owned resources' }],
  ];
  for (const [scrambled, canonical] of forms) {
    assert.equal(skillId({ ...baseSummary, resourceBase: scrambled }), expectedId({ ...baseSummary, resourceBase: canonical }));
  }
  assert.equal(skillId({ ...baseSummary, resourceBase: undefined }), skillId({ ...baseSummary, resourceBase: null }));
});

test('file IDs remain byte-for-byte compatible, scoped virtual instances stay distinct by provider/name/resource not context', () => {
  const file = { ...baseSummary, path: '/fixture/workspace/skills/example/SKILL.md' };
  assert.equal(skillId(file), legacyId(file, 'old-context'));
  assert.equal(skillId(file), expectedId(file));
  assert.notEqual(skillId(file), skillId({ ...file, path: '/fixture/other/skills/example/SKILL.md' }));
  for (const change of [{ provider: 'other-provider' }, { name: 'other-name' }, { resourceBase: { kind: 'opaque', description: 'Other resources' } }]) {
    assert.notEqual(skillId(baseSummary), skillId({ ...baseSummary, ...change }));
  }
});

test('unresolved identities never merge into an observed virtual definition', () => {
  const unresolved = { ...baseSummary, source: 'unknown' };
  assert.equal(skillId(unresolved), expectedId(unresolved));
  assert.notEqual(skillId(unresolved), skillId(baseSummary));
  assert.equal(skillId(unresolved, 'legacy-a'), skillId(unresolved, 'legacy-b'));
});

test('v1 three-context migration merges definitions and preserves every history row and original invocation key', async t => {
  const filename = await ownedDatabase(t);
  const entries = [
    { contextId: 'host', skill: { description: 'Old host metadata', source: 'custom' }, firstSeenAt: EARLY, lastSeenAt: EARLY },
    { contextId: 'preset', skill: { description: 'Preset metadata', invocation: { modelInvocable: false, userInvocable: true } }, firstSeenAt: MIDDLE, lastSeenAt: MIDDLE },
    { contextId: 'agent', skill: { description: 'Newest metadata', source: 'runtime' }, firstSeenAt: LATEST, lastSeenAt: LATEST },
  ];
  const before = seed(filename, entries);
  const store = open(t, filename), rows = store.snapshot();
  assert.equal(rows.length, 1);
  const row = rows[0], id = expectedId(baseSummary);
  assert.equal(row.id, id);
  assert.equal(row.firstSeenAt, EARLY);
  assert.equal(row.lastSeenAt, LATEST);
  assert.equal(row.description, 'Newest metadata');
  assert.equal(row.source, 'runtime');
  assert.equal(row.usage.total, 3);
  assert.deepEqual(row.availability.map(item => item.contextId).sort(), ['agent', 'host', 'preset']);
  assert.ok(row.availability.every(item => item.effective));
  for (const entry of entries) {
    const membership = row.availability.find(item => item.contextId === entry.contextId);
    const original = { ...baseSummary, ...entry.skill };
    assert.equal(membership.source, original.source);
    assert.equal(membership.description, original.description);
    assert.deepEqual(membership.invocation, original.invocation);
    assert.deepEqual(membership.resourceBase, original.resourceBase);
  }
  assert.equal(store.since(), SINCE);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(plainRows(store.db.prepare('SELECT * FROM meta ORDER BY key').all()), before.meta);
  const afterEvents = plainRows(store.db.prepare('SELECT * FROM events ORDER BY id').all());
  const afterInvocations = plainRows(store.db.prepare('SELECT * FROM invocations ORDER BY event_key').all());
  assert.deepEqual(withoutSkillId(afterEvents).map(({ details, ...event }) => event), withoutSkillId(before.events).map(({ details, ...event }) => event));
  for (const [index, event] of afterEvents.entries()) {
    const details = JSON.parse(event.details), original = JSON.parse(before.events[index].details);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(details[key], value);
    if (details.identityMigration) assert.deepEqual(details.identityMigration, { previousId: before.events[index].skill_id, identityVersion: 2 });
  }
  assert.deepEqual(withoutSkillId(afterInvocations), withoutSkillId(before.invocations));
  assert.ok(afterEvents.every(event => event.skill_id === id));
  assert.ok(afterInvocations.every(event => event.skill_id === id));
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const legacy of before.skills) {
    const detail = store.detail(legacy.id, { limit: 200 });
    assert.equal(detail.skill.id, id);
    assert.equal(detail.total, 6);
    assert.deepEqual(detail.events.map(event => event.id).sort((a, b) => a - b), before.events.map(event => event.id));
  }
  assert.equal(store.detail('not-a-former-id'), null);
  assert.equal(store.invocation({ eventKey: before.invocations[1].event_key, name: baseSummary.name, provider: baseSummary.provider,
    at: NOW, actor, outcome: 'success', channel: 'tool' }), false);
  assert.equal(store.snapshot()[0].usage.total, 3);
});

test('merged duplicate memberships retain effective true if any legacy copy is effective', async t => {
  const filename = await ownedDatabase(t);
  seed(filename, [
    { contextId: 'old-a', skill: { source: 'custom', description: 'Older membership' }, lastSeenAt: EARLY, memberships: [{ contextId: 'shared', cwd: '/fixture/workspace', effective: true }] },
    { contextId: 'old-b', skill: { source: 'runtime', description: 'Newest membership' }, lastSeenAt: LATEST, memberships: [{ contextId: 'shared', cwd: '/fixture/workspace', effective: false }] },
  ]);
  const store = open(t, filename);
  assert.equal(store.snapshot().length, 1);
  assert.equal(store.snapshot()[0].availability.length, 1);
  assert.equal(store.snapshot()[0].availability[0].effective, true);
  assert.equal(store.snapshot()[0].availability[0].source, 'runtime');
  assert.equal(store.snapshot()[0].availability[0].description, 'Newest membership');
  assert.equal(store.snapshot()[0].usage.total, 2);
});

test('migration handles each virtual resource base and preserves distinct file IDs', async t => {
  const filename = await ownedDatabase(t);
  const variants = [
    ...[undefined, { kind: 'directory', path: '/fixture/resources' }, { kind: 'url', url: 'https://example.invalid/skill' }, { kind: 'opaque', description: 'Opaque resources' }]
      .flatMap((resourceBase, index) => [{ contextId: `old-${index}-a`, skill: { name: `skill-${index}`, resourceBase } },
        { contextId: `old-${index}-b`, skill: { name: `skill-${index}`, resourceBase } }]),
    { contextId: 'file-a', skill: { name: 'file-skill', path: '/fixture/a/SKILL.md' } },
    { contextId: 'file-b', skill: { name: 'file-skill', path: '/fixture/b/SKILL.md' } },
  ];
  const before = seed(filename, variants), store = open(t, filename), rows = store.snapshot();
  assert.equal(rows.length, 6);
  assert.equal(rows.reduce((sum, row) => sum + row.usage.total, 0), 10);
  for (const legacy of before.skills) {
    const original = JSON.parse(legacy.data), detail = store.detail(legacy.id);
    assert.equal(detail.skill.id, expectedId(original));
    if (original.path) assert.equal(detail.skill.id, legacy.id);
  }
});

test('legacy unresolved rows remain isolated from otherwise identical known definitions', async t => {
  const filename = await ownedDatabase(t);
  const before = seed(filename, [
    { contextId: 'real', skill: { source: 'bundled' } },
    { contextId: 'unknown-a', skill: { source: 'unknown' } },
    { contextId: 'unknown-b', skill: { source: 'unknown' } },
  ]);
  const store = open(t, filename), rows = store.snapshot();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.source === 'unknown').usage.total, 2);
  assert.equal(rows.find(row => row.source !== 'unknown').usage.total, 1);
  for (const legacy of before.skills) assert.equal(store.detail(legacy.id).skill.source === 'unknown', JSON.parse(legacy.data).source === 'unknown');
});

test('scope churn updates memberships and per-scope catalog metadata without creating instances or rediscovery events', t => {
  const store = open(t, ':memory:');
  store.observe([{ contextId: 'old-agent', cwd: '/fixture/a', complete: true, skills: [{ ...baseSummary, source: 'custom', description: 'Scope A',
    invocation: { modelInvocable: false, userInvocable: true } }] }], { at: EARLY });
  store.observe([{ contextId: 'new-agent', cwd: '/fixture/b', complete: true, skills: [{ ...baseSummary, id: 'obsolete-preassigned-scope-id', source: 'runtime', description: 'Scope B',
    invocation: { modelInvocable: true, userInvocable: false } }] }], { at: LATEST });
  store.reconcileContexts(['new-agent'], NOW);
  const rows = store.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, expectedId(baseSummary));
  assert.equal(rows[0].firstSeenAt, EARLY);
  assert.equal(rows[0].lastSeenAt, LATEST);
  assert.equal(store.detail(rows[0].id).events.filter(event => event.kind === 'discovered').length, 1);
  const old = rows[0].availability.find(item => item.contextId === 'old-agent');
  const current = rows[0].availability.find(item => item.contextId === 'new-agent');
  assert.equal(old.effective, false);
  assert.equal(current.effective, true);
  assert.equal(old.source, 'custom');
  assert.equal(old.description, 'Scope A');
  assert.deepEqual(old.invocation, { modelInvocable: false, userInvocable: true });
  assert.deepEqual(old.resourceBase, baseSummary.resourceBase);
  assert.equal(current.source, 'runtime');
  assert.equal(current.description, 'Scope B');
  assert.deepEqual(current.invocation, { modelInvocable: true, userInvocable: false });
});

test('successful migration is idempotent across multiple real reopen cycles, including alias history', async t => {
  const filename = await ownedDatabase(t);
  const before = seed(filename, [{ contextId: 'first' }, { contextId: 'second' }, { contextId: 'third' }]);
  let expected;
  for (let index = 0; index < 3; index++) {
    const store = new SkillStore(filename, { now: () => NOW });
    try {
      const snapshot = store.snapshot();
      expected ??= snapshot;
      assert.deepEqual(snapshot, expected);
      assert.equal(store.since(), SINCE);
      assert.equal(snapshot.length, 1);
      assert.equal(snapshot[0].usage.total, 3);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 6);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM invocations').get().n, 3);
      for (const legacy of before.skills) assert.equal(store.detail(legacy.id).total, 6);
    } finally { store.close(); }
  }
});

test('unknown future schema refuses to open without resetting data or version', async t => {
  const filename = await ownedDatabase(t), before = seed(filename, [{ contextId: 'legacy' }]);
  readFixture(filename, db => db.exec('PRAGMA user_version=999'));
  assert.throws(() => new SkillStore(filename), /(?:Unsupported|unsupported|newer|version)/);
  readFixture(filename, db => {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 999);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM skills ORDER BY id').all()), before.skills);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM events ORDER BY id').all()), before.events);
  });
});

test('malformed legacy JSON rolls back the entire migration and remains recoverable as v1', async t => {
  const filename = await ownedDatabase(t), before = seed(filename, [{ contextId: 'first' }, { contextId: 'second' }, { contextId: 'third' }]);
  const corruptedId = before.skills.at(-1).id;
  readFixture(filename, db => db.prepare('UPDATE skills SET data=? WHERE id=?').run('{not-json', corruptedId));
  const damaged = readFixture(filename, db => ({ skills: plainRows(db.prepare('SELECT * FROM skills ORDER BY id').all()),
    tables: plainRows(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()) }));
  assert.throws(() => new SkillStore(filename));
  readFixture(filename, db => {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM skills ORDER BY id').all()), damaged.skills);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM availability ORDER BY skill_id,context_id').all()), before.availability);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM events ORDER BY id').all()), before.events);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM invocations ORDER BY event_key').all()), before.invocations);
    assert.deepEqual(plainRows(db.prepare('SELECT * FROM meta ORDER BY key').all()), before.meta);
    assert.deepEqual(plainRows(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()), damaged.tables);
  });
});

for (const [label, payload] of [
  ['non-object', '[]'],
  ['missing identity fields', JSON.stringify({ name: 'example' })],
  ['invalid resource-base fields', JSON.stringify({ ...baseSummary, resourceBase: { kind: 'url' } })],
]) {
  test(`invalid legacy ${label} refuses migration without merging damaged identities`, async t => {
    const filename = await ownedDatabase(t), before = seed(filename, [{ contextId: 'legacy' }]);
    readFixture(filename, db => db.prepare('UPDATE skills SET data=? WHERE id=?').run(payload, before.skills[0].id));
    assert.throws(() => new SkillStore(filename));
    readFixture(filename, db => {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
      assert.equal(db.prepare('SELECT data FROM skills').get().data, payload);
      assert.deepEqual(plainRows(db.prepare('SELECT * FROM invocations ORDER BY event_key').all()), before.invocations);
    });
  });
}
