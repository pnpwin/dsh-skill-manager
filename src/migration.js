import { skillId } from './identity.js';

/** Add a transactional filesystem-operation journal; existing identities/history are untouched. */
export function migrateManagementV3(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE file_controls (skill_id TEXT PRIMARY KEY REFERENCES skills(id), data TEXT NOT NULL); PRAGMA user_version=3; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const json = value => JSON.stringify(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function readObject(raw) {
  const value = JSON.parse(raw);
  if (!object(value)) throw new Error('Invalid legacy skill-manager record: expected a JSON object');
  return value;
}
/** Scope metadata belongs to a membership, not the instance identity. */
export function membershipOf(skill, entry) {
  return { source: skill.source, description: skill.description, invocation: skill.invocation,
    resourceBase: skill.resourceBase ?? null, ...entry };
}
/** Atomically consolidate v1 scope-fragmented rows without rewriting invocation identities. */
export function migrateIdentityV2(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS skill_aliases (alias TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id))');
    const groups = new Map();
    for (const row of db.prepare('SELECT id,data FROM skills ORDER BY id').all()) {
      const skill = readObject(row.data);
      if (typeof skill.name !== 'string' || !skill.name || typeof skill.provider !== 'string' || !skill.provider) throw new Error('Invalid legacy skill-manager identity fields');
      const id = skillId(skill);
      const records = groups.get(id) ?? [];
      records.push({ ...skill, id: row.id });
      groups.set(id, records);
    }
    for (const [id, records] of groups) {
      records.sort((a, b) => (a.lastSeenAt ?? '').localeCompare(b.lastSeenAt ?? '') || a.id.localeCompare(b.id));
      const latest = records.at(-1);
      const firstSeenAt = records.map(row => row.firstSeenAt).filter(Boolean).sort()[0] ?? latest.firstSeenAt;
      const merged = { ...latest, id, firstSeenAt };
      const memberships = new Map();
      for (const record of records) {
        for (const row of db.prepare('SELECT context_id,data FROM availability WHERE skill_id=? ORDER BY context_id').all(record.id)) {
          const entry = membershipOf(record, readObject(row.data));
          const previous = memberships.get(row.context_id);
          memberships.set(row.context_id, { ...entry, contextId: row.context_id, effective: entry.effective === true || previous?.effective === true });
        }
      }
      if (!merged.path && merged.source !== 'unknown') {
        if ([...memberships.values()].some(entry => entry.effective)) merged.status = 'present';
        else if (merged.status === 'present') merged.status = 'unavailable';
      }
      db.prepare('INSERT INTO skills VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, json(merged));
      // Capture membership data before removing any former row, including a pre-existing target.
      for (const record of records) db.prepare('DELETE FROM availability WHERE skill_id=?').run(record.id);
      for (const [contextId, entry] of memberships) db.prepare('INSERT INTO availability VALUES (?,?,?)').run(id, contextId, json(entry));
      for (const record of records) {
        if (record.id === id) continue;
        for (const event of db.prepare('SELECT id,details FROM events WHERE skill_id=?').all(record.id)) {
          const details = { ...readObject(event.details), identityMigration: { previousId: record.id, identityVersion: 2 } };
          db.prepare('UPDATE events SET skill_id=?,details=? WHERE id=?').run(id, json(details), event.id);
        }
        db.prepare('UPDATE invocations SET skill_id=? WHERE skill_id=?').run(id, record.id);
        db.prepare('UPDATE skill_aliases SET skill_id=? WHERE skill_id=?').run(id, record.id);
        db.prepare('INSERT INTO skill_aliases VALUES (?,?) ON CONFLICT(alias) DO UPDATE SET skill_id=excluded.skill_id').run(record.id, id);
        db.prepare('DELETE FROM skills WHERE id=?').run(record.id);
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Skill manager identity migration failed foreign key validation');
    db.exec('PRAGMA user_version=2; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
