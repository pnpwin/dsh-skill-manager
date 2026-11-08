import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillManager } from '../src/service.js';
import { resolveConfig } from '../src/config.js';
import { getSkillManager } from '../src/api.js';

const skill = { name: 'test-skill', provider: 'test-provider', source: 'runtime', description: 'fixture' };
const actor = { kind: 'agent', label: 'Test agent', sessionId: 'fixture' };
function fixture(t, options = {}) {
  let callbacks, observations = [{ contextId: 'context', skills: [skill], complete: true }];
  let detached = false, calls = 0;
  const published = [];
  const adapter = { attach(value) { callbacks = value; return () => { detached = true; }; }, async discover(request) {
    calls++; return options.discover ? options.discover(request) : { contexts: [{ id: 'context', label: 'Test', cwd: null }], observations, warnings: [] };
  } };
  const manager = createSkillManager({ adapter, filename: ':memory:', config: resolveConfig({ scanIntervalMs: 86400000, debounceMs: 0 }), publish: value => published.push(value), ...options.manager });
  t.after(() => manager.dispose());
  return { manager, published, get callbacks() { return callbacks; }, get detached() { return detached; }, get calls() { return calls; }, set observations(value) { observations = value; } };
}

test('shared API refresh returns real catalog and counts metadata-only invocation observations', async t => {
  const f = fixture(t);
  const snapshot = await f.manager.refresh();
  assert.equal(snapshot.apiVersion, 1);
  assert.equal(snapshot.skills.length, 1);
  f.callbacks.invocation({ eventKey: 'call-1', name: skill.name, provider: skill.provider, contextId: 'context', actor, at: new Date().toISOString(), outcome: 'success', channel: 'tool' });
  assert.equal(f.manager.snapshot().skills[0].usage.total, 1);
  assert.equal(f.manager.detail(snapshot.skills[0].id).events[0].kind, 'invocation');
  assert.equal(f.manager.snapshot().coverage.mode, 'observed');
  assert.ok(f.manager.snapshot().coverage.notes.some(note => note.includes('not backfilled')));
  assert.equal(getSkillManager({ get: () => f.manager }), f.manager);
  assert.throws(() => getSkillManager({ get: () => ({ apiVersion: 2 }) }), /unavailable/);
});

test('refreshes are single-flight and startup observations drain after catalog commit', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { discover: async () => { await waiting; return { contexts: [{ id: 'context' }], observations: [{ contextId: 'context', complete: true, skills: [skill] }], warnings: [] }; } });
  const one = f.manager.refresh(), two = f.manager.refresh();
  assert.equal(one, two);
  f.callbacks.invocation({ eventKey: 'call-1', name: skill.name, provider: skill.provider, actor, at: new Date().toISOString(), outcome: 'success', channel: 'ptc' });
  release();
  await one;
  assert.equal(f.calls, 1);
  assert.equal(f.manager.snapshot().skills.length, 1);
  assert.equal(f.manager.snapshot().skills[0].usage.total, 1);
});

test('provider failure retains inventory and exposes explicit degraded health', async t => {
  let failure = false;
  const f = fixture(t, { discover: async () => {
    if (failure) throw Error('private failure text must not leak');
    return { contexts: [{ id: 'context' }], observations: [{ contextId: 'context', skills: [skill], complete: true }], warnings: [] };
  } });
  await f.manager.refresh(); failure = true;
  await assert.rejects(f.manager.refresh());
  const snapshot = f.manager.snapshot();
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.warnings[0].code, 'refresh-failed');
  assert.ok(!JSON.stringify(snapshot).includes('private failure'));
});

test('listeners cannot veto persistence, unsubscribe and disposal release resources', async t => {
  const f = fixture(t);
  let seen = 0;
  f.manager.subscribe(() => { throw Error('observer'); });
  const unsubscribe = f.manager.subscribe(() => seen++);
  await f.manager.refresh();
  assert.equal(seen, 1);
  unsubscribe();
  await f.manager.refresh();
  assert.equal(seen, 1);
  await f.manager.dispose();
  assert.equal(f.detached, true);
  assert.throws(() => f.manager.snapshot(), /disposed/);
  await assert.rejects(f.manager.refresh(), /disposed/);
});

test('disposal aborts in-flight discovery and still commits already accepted invocations', async t => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { discover: async ({ signal }) => { entered(); await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); } });
  const pending = f.manager.refresh();
  await ready;
  f.callbacks.invocation({ eventKey: 'before-dispose', name: skill.name, actor, at: new Date().toISOString(), outcome: 'success', channel: 'tool' });
  const check = pending.catch(() => {});
  await f.manager.dispose(); await check;
  assert.equal(f.detached, true);
  assert.equal(f.published.some(event => event.type === 'invocation'), true);
});

test('timeout settles callers and unload without overlapping stalled providers or publishing late results', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { discover: () => pending, manager: { config: resolveConfig({ scanIntervalMs: 86400000, scanTimeoutMs: 100 }) } });
  await assert.rejects(f.manager.refresh(), /timed out/);
  assert.equal(f.manager.snapshot().warnings[0].code, 'refresh-failed');
  await assert.rejects(f.manager.refresh(), /still draining/);
  assert.equal(f.calls, 1);
  await f.manager.dispose();
  release({ contexts: [{ id: 'context' }], observations: [{ contextId: 'context', complete: true, skills: [skill] }], warnings: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.published.filter(event => event.type === 'inventory').length, 0);
});

test('configuration rejects typos and relative paths at activation', () => {
  for (const value of [{ scanIntervalMs: 0 }, { workspaceDirs: ['relative'] }, { databasePath: 'relative' }, { accidental: true }, { maxFileBytes: 1.5 }]) assert.throws(() => resolveConfig(value));
  assert.equal(resolveConfig().scanIntervalMs, 60000);
});
