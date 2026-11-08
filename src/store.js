import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { skillId, canonicalResourceBase } from './identity.js';
import { migrateIdentityV2, membershipOf } from './migration.js';
export { skillId } from './identity.js';

const DAY = 86400000;
const encode = value => JSON.stringify(value);
const decode = value => JSON.parse(value);
/** Plugin-owned SQLite index. It never stores instruction bodies or raw session logs. */
export class SkillStore {
  constructor(filename, { now = () => new Date().toISOString() } = {}) {
    this.now = now;
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 2) throw new Error(`Unsupported skill-manager database version ${version}; a newer plugin is required`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS availability (skill_id TEXT NOT NULL REFERENCES skills(id), context_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(skill_id,context_id));
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, skill_id TEXT NOT NULL REFERENCES skills(id), kind TEXT NOT NULL, at TEXT NOT NULL, actor TEXT, details TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_skill_time ON events(skill_id,at DESC,id DESC);
        CREATE TABLE IF NOT EXISTS invocations (event_key TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id), at TEXT NOT NULL, actor TEXT NOT NULL, outcome TEXT NOT NULL, channel TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS invocation_skill_time ON invocations(skill_id,at DESC,event_key);
      `);
      if (version < 2) migrateIdentityV2(this.db);
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('since', now());
      if (filename !== ':memory:') chmodSync(filename, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  canonicalId(id) { return this.db.prepare('SELECT skill_id FROM skill_aliases WHERE alias=?').get(id)?.skill_id ?? id; }
  get(id) { const row = this.db.prepare('SELECT data FROM skills WHERE id=?').get(this.canonicalId(id)); return row ? decode(row.data) : null; }
  put(skill) { this.db.prepare('INSERT INTO skills VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(skill.id, encode(skill)); }
  event(id, kind, at, actor = null, details = {}, key = null) {
    this.db.prepare('INSERT OR IGNORE INTO events(event_key,skill_id,kind,at,actor,details) VALUES (?,?,?,?,?,?)').run(key, id, kind, at, actor ? encode(actor) : null, encode(details));
  }
  /** Commit a whole catalog observation. An incomplete catalog cannot imply deletion. */
  observe(observations, { at = this.now() } = {}) {
    return this.transaction(() => {
      for (const { contextId, cwd, complete, skills } of observations) {
        const seen = new Set();
        for (const item of skills) {
          const id = skillId(item);
          seen.add(id);
          const old = this.get(id);
          const { file = {}, ...summary } = item;
          const skill = {
            ...old, ...summary, id, path: item.path ?? null,
            status: file.status ?? (item.path ? 'unknown' : 'present'),
            firstSeenAt: old?.firstSeenAt ?? at, lastSeenAt: at,
            createdAt: file.createdAt ?? old?.createdAt ?? null,
            createdEvidence: file.createdAt ? 'filesystem-birthtime' : old?.createdEvidence ?? 'unknown',
            createdBy: old?.createdBy ?? null,
            modifiedAt: file.modifiedAt ?? old?.modifiedAt ?? null,
            modifiedBy: old?.modifiedBy ?? null,
            contentHash: Object.hasOwn(file, 'contentHash') ? file.contentHash : old?.contentHash ?? null,
          };
          const changed = old && file.contentHash && old.contentHash && file.contentHash !== old.contentHash;
          const versionChanged = old?.fileVersion && file.version && file.version !== old.fileVersion;
          skill.fileVersion = file.version ?? old?.fileVersion ?? null;
          if (changed || versionChanged) skill.modifiedBy = null;
          if (file.version && old?.pendingMutation?.version === file.version) {
            skill.modifiedBy = old.pendingMutation.actor;
            delete skill.pendingMutation;
          }
          if (!old) this.eventAfterPut(skill, 'discovered', at, null, { evidence: 'catalog-observation' });
          else {
            this.put(skill);
            if (changed) this.event(id, 'modified', at, null, { previousHash: old.contentHash, contentHash: file.contentHash, evidence: 'instruction-file-hash' });
            else if (versionChanged && file.contentHash === null) this.event(id, 'modified', at, null, { evidence: 'filesystem-version', currentHashUnavailable: true });
            if (old.status !== skill.status) this.event(id, skill.status === 'present' ? 'restored' : skill.status, at);
          }
          this.db.prepare('INSERT INTO availability VALUES (?,?,?) ON CONFLICT(skill_id,context_id) DO UPDATE SET data=excluded.data').run(id, contextId, encode(membershipOf(summary, { contextId, cwd, effective: true })));
        }
        if (complete) {
          for (const row of this.db.prepare('SELECT skill_id,data FROM availability WHERE context_id=?').all(contextId)) {
            if (!seen.has(row.skill_id)) {
              const availability = { ...decode(row.data), effective: false };
              this.db.prepare('UPDATE availability SET data=? WHERE skill_id=? AND context_id=?').run(encode(availability), row.skill_id, contextId);
            }
          }
        }
      }
    });
  }
  eventAfterPut(skill, kind, at, actor, details) { this.put(skill); this.event(skill.id, kind, at, actor, details); }
  /** Retire context memberships only after a successful bounded context enumeration. */
  reconcileContexts(contextIds, at = this.now()) {
    this.transaction(() => {
      const active = new Set(contextIds);
      for (const row of this.db.prepare('SELECT skill_id,context_id,data FROM availability').all()) {
        if (!active.has(row.context_id)) this.db.prepare('UPDATE availability SET data=? WHERE skill_id=? AND context_id=?').run(encode({ ...decode(row.data), effective: false }), row.skill_id, row.context_id);
      }
      for (const { data } of this.db.prepare('SELECT data FROM skills').all()) {
        const skill = decode(data);
        if (skill.path || skill.status !== 'present') continue;
        const effective = this.db.prepare('SELECT data FROM availability WHERE skill_id=?').all(skill.id).some(row => decode(row.data).effective);
        if (!effective) { skill.status = 'unavailable'; this.put(skill); this.event(skill.id, 'unavailable', at); }
      }
    });
  }
  /** Refresh physical state independently from effective catalog membership. */
  physical(id, file, at = this.now()) {
    id = this.canonicalId(id);
    return this.transaction(() => {
      const old = this.get(id);
      if (!old) return;
      const changed = file.contentHash && old.contentHash && file.contentHash !== old.contentHash;
      const versionChanged = old.fileVersion && file.version && file.version !== old.fileVersion;
      const verifiedWriter = file.version && old.pendingMutation?.version === file.version ? old.pendingMutation.actor : null;
      const next = { ...old, status: file.status, modifiedAt: file.modifiedAt ?? old.modifiedAt, contentHash: Object.hasOwn(file, 'contentHash') ? file.contentHash : old.contentHash, fileVersion: file.version ?? old.fileVersion, modifiedBy: verifiedWriter ?? (changed || versionChanged ? null : old.modifiedBy) };
      if (verifiedWriter) delete next.pendingMutation;
      this.put(next);
      if (changed) this.event(id, 'modified', at, null, { previousHash: old.contentHash, contentHash: file.contentHash, evidence: 'instruction-file-hash' });
      else if (versionChanged && file.contentHash === null) this.event(id, 'modified', at, null, { evidence: 'filesystem-version', currentHashUnavailable: true });
      if (old.status !== next.status) this.event(id, next.status === 'present' ? 'restored' : next.status, at);
    });
  }
  /** A positive filesystem mutation observation identifies a writer, not the original author. */
  mutation({ eventKey, path, at, actor, observation }) {
    return this.transaction(() => {
      for (const row of this.db.prepare('SELECT data FROM skills').all()) {
        const skill = decode(row.data);
        if (!skill.path || resolve(skill.path) !== resolve(path)) continue;
        if (this.db.prepare('SELECT 1 FROM events WHERE event_key=?').get(`${eventKey}:${skill.id}`)) continue;
        if (observation.version && observation.version === skill.fileVersion) skill.modifiedBy = actor;
        // Attribute the current revision only if a subsequent stable read matches this token.
        skill.pendingMutation = { actor, at, version: observation.version ?? null };
        this.put(skill);
        this.event(skill.id, 'mutation', at, actor, { observation }, `${eventKey}:${skill.id}`);
      }
    });
  }
  /** Match only a unique observed identity; ambiguity stays explicitly unresolved. */
  resolveInvocation(invocation) {
    const candidates = this.db.prepare('SELECT data FROM skills').all().map(row => decode(row.data)).filter(skill =>
      skill.source !== 'unknown' && skill.name === invocation.name && (!invocation.provider || skill.provider === invocation.provider)
      && (!invocation.path || skill.path && resolve(skill.path) === resolve(invocation.path))
      && (!invocation.resourceBase || encode(canonicalResourceBase(skill.resourceBase)) === encode(canonicalResourceBase(invocation.resourceBase))));
    if (invocation.contextId) {
      const contextual = candidates.filter(skill => {
        const membership = this.db.prepare('SELECT data FROM availability WHERE skill_id=? AND context_id=?').get(skill.id, invocation.contextId);
        return membership && decode(membership.data).effective;
      });
      if (contextual.length === 1) return contextual[0];
      // A name visible only in another scope is not this agent's definition.
      // Successful output with explicit provider/location can still identify a newly seen scope.
      if (!invocation.path && !(invocation.outcome === 'success' && invocation.provider && invocation.resourceBase)) return null;
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  invocation(input) {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM invocations WHERE event_key=?').get(input.eventKey)) return false;
      let skill = this.resolveInvocation(input);
      if (!skill) {
        const summary = { name: input.name, provider: input.provider ?? 'unknown', source: 'unknown', description: '', path: input.path ?? null, resourceBase: canonicalResourceBase(input.resourceBase) };
        const id = skillId(summary);
        skill = this.get(id) ?? { ...summary, id, status: 'unknown', firstSeenAt: input.at, lastSeenAt: input.at, createdAt: null, createdEvidence: 'unknown', createdBy: null, modifiedAt: null, modifiedBy: null, contentHash: null };
        this.put(skill);
      }
      this.db.prepare('INSERT INTO invocations VALUES (?,?,?,?,?,?)').run(input.eventKey, skill.id, input.at, encode(input.actor), input.outcome, input.channel);
      this.event(skill.id, 'invocation', input.at, input.actor, { outcome: input.outcome, channel: input.channel, identity: skill.source === 'unknown' ? 'unresolved' : 'observed' }, input.eventKey);
      return true;
    });
  }
  /** Return rolling elapsed-time windows (not calendar days), inclusive lower bound. */
  snapshot(now = this.now()) {
    const time = Date.parse(now);
    const counts = new Map(this.db.prepare(`SELECT skill_id,COUNT(*) AS total,
      SUM(CASE WHEN at>=? AND at<=? THEN 1 ELSE 0 END) AS count24h,
      SUM(CASE WHEN at>=? AND at<=? THEN 1 ELSE 0 END) AS count7d
      FROM invocations GROUP BY skill_id`).all(new Date(time - DAY).toISOString(), now, new Date(time - 7 * DAY).toISOString(), now).map(row => [row.skill_id, row]));
    return this.db.prepare('SELECT data FROM skills').all().map(({ data }) => {
      const skill = decode(data);
      delete skill.pendingMutation;
      delete skill.fileVersion;
      const count = counts.get(skill.id);
      const last = this.db.prepare('SELECT at,actor FROM invocations WHERE skill_id=? AND at<=? ORDER BY at DESC,event_key DESC LIMIT 1').get(skill.id, now);
      const availability = this.db.prepare('SELECT data FROM availability WHERE skill_id=? ORDER BY context_id').all(skill.id).map(row => decode(row.data));
      return { ...skill, availability, usage: { count24h: count?.count24h ?? 0, count7d: count?.count7d ?? 0, total: count?.total ?? 0, lastAt: last?.at ?? null, lastActor: last ? decode(last.actor) : null } };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  detail(id, { offset = 0, limit = 50 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid history pagination');
    id = this.canonicalId(id);
    const skill = this.snapshot().find(item => item.id === id);
    if (!skill) return null;
    const events = this.db.prepare('SELECT id,kind,at,actor,details FROM events WHERE skill_id=? ORDER BY at DESC,id DESC LIMIT ? OFFSET ?').all(id, limit, offset).map(row => ({ ...row, actor: row.actor ? decode(row.actor) : null, details: decode(row.details) }));
    return { skill, events, offset, limit, total: this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE skill_id=?').get(id).n };
  }
  since() { return this.db.prepare('SELECT value FROM meta WHERE key=?').get('since').value; }
  close() { this.db.close(); }
}
