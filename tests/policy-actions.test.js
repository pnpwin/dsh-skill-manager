import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillStore, skillId } from '../src/store.js';
import { createPolicyActions } from '../src/policy-actions.js';
import { createSkillManager } from '../src/service.js';
import { resolveConfig } from '../src/config.js';

const NOW = '2026-11-08T00:00:00.000Z';
const summary = { name: 'packaged-policy-fixture', provider: 'fixture-plugin', source: 'bundled', description: 'Metadata only', path: null,
  resourceBase: { kind: 'opaque', description: 'Provider-owned resources' }, invocation: { modelInvocable: true, userInvocable: false } };
const owner = { kind: 'user', label: 'Owner UI' };
const rejects = (operation, code, status) => assert.rejects(Promise.resolve().then(operation), error => error.code === code && (status === undefined || error.status === status));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const rows = store => JSON.stringify(Object.fromEntries(['skills', 'events', 'invocations', 'file_controls'].map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));

function fixture(t, options = {}) {
  let clock = Date.parse(NOW), syncCalls = 0;
  const now = () => new Date(clock).toISOString();
  const store = new SkillStore(':memory:', { now });
  const skill = { ...summary, ...options.summary };
  store.observe([{ contextId: 'fixture-scope', cwd: null, complete: true, skills: [skill] }]);
  const id = skillId(skill), reports = [], controllers = [];
  const state = { get: value => store.get(value), getControl: value => store.getControl(value), listControls: () => store.listControls(), saveControl: (...args) => store.saveControl(...args) };
  const runtime = { supported: true, sync: async () => { syncCalls++; await options.sync?.(); }, ...options.runtime };
  const make = () => {
    const controller = createPolicyActions({ state, runtime, config: { actionTokenTtlMs: 1000, ...options.config }, now, report: (...args) => reports.push(args) });
    controllers.push(controller); return controller;
  };
  const actions = make();
  t.after(async () => { try { for (const controller of controllers) await controller.dispose(); } finally { store.close(); } });
  return { store, id, state, runtime, actions, make, reports, advance: value => { clock += value; }, syncCalls: () => syncCalls };
}

function policyPlan(plan, id, action) {
  assert.equal(plan.id, id); assert.equal(plan.action, action);
  assert.equal(plan.mode, 'override'); assert.equal(plan.targetKind, 'policy');
  assert.equal(plan.path, null); assert.equal(plan.fileCount, 0); assert.equal(plan.totalBytes, 0);
  assert.equal(plan.confirmationText, null);
  assert.notEqual(plan.operationId, plan.token);
  assert.match(plan.token, /^[a-f0-9-]{36}$/); assert.match(plan.operationId, /^[a-f0-9-]{36}$/);
  assert.ok(plan.warnings.some(value => /already loaded/i.test(value)));
  assert.ok(plan.warnings.some(value => /original invocation permissions/i.test(value)));
}
function privateTokenAbsent(store, token) {
  assert.ok(!rows(store).includes(token), 'Secret confirmation token must not enter any persisted table');
  assert.ok(!JSON.stringify(store.snapshot()).includes(token));
  assert.ok(!JSON.stringify(store.detail(store.snapshot()[0].id)).includes(token));
  assert.ok(!rows(store).includes('instructionBody'));
}

test('policy prepare is pure, bounded, no-file, and uses a separate public operation receipt', t => {
  const f = fixture(t), before = rows(f.store), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  policyPlan(plan, f.id, 'disable');
  assert.equal(plan.expiresAt, '2026-11-08T00:00:01.000Z');
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
  assert.deepEqual(f.actions.operationStatus({ id: f.id, operationId: plan.operationId }), { id: f.id, operationId: plan.operationId, action: 'disable', status: 'not-started' });
  assert.equal(f.actions.operationStatus({ id: '0'.repeat(64), operationId: plan.operationId }).status, 'unknown');
  plan.warnings.push('caller mutation');
  privateTokenAbsent(f.store, plan.token);
});

test('disable persists only a per-instance deny and audited owner receipt; enable removes only that deny', async t => {
  const f = fixture(t), before = f.store.detail(f.id), original = f.store.get(f.id), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  const result = await f.actions.execute({ token: plan.token });
  assert.equal(result.management.workingStatus, 'disabled'); assert.deepEqual(result.management.allowedActions, ['enable']);
  assert.equal(f.store.getControl(f.id).invocationOverride.disabled, true);
  assert.deepEqual(f.store.getControl(f.id).lastOperation, { id: plan.operationId, action: 'disable', status: 'succeeded', mode: 'override', at: NOW });
  assert.equal(f.actions.operationStatus({ id: f.id, operationId: plan.operationId }).status, 'succeeded');
  assert.equal(f.syncCalls(), 1);
  const event = f.store.detail(f.id).events[0];
  assert.equal(event.kind, 'invocation-disabled'); assert.deepEqual(event.actor, owner);
  assert.deepEqual(event.details, { operationId: plan.operationId, action: 'disable', mode: 'override' });
  assert.deepEqual(f.store.get(f.id), original, 'Provider metadata and its intrinsic invocation permissions are not rewritten');
  assert.deepEqual(f.store.detail(f.id).skill.usage, before.skill.usage);
  privateTokenAbsent(f.store, plan.token);
  await rejects(() => f.actions.execute({ token: plan.token }), 'expired', 410);
  const enable = f.actions.prepare({ id: f.id, action: 'enable' }); policyPlan(enable, f.id, 'enable');
  const enabled = await f.actions.execute({ token: enable.token });
  assert.equal(enabled.management.workingStatus, 'enabled');
  assert.equal(f.store.getControl(f.id).invocationOverride, undefined);
  assert.equal(f.store.detail(f.id).events[0].kind, 'invocation-enabled');
  assert.deepEqual(f.store.get(f.id).invocation, { modelInvocable: true, userInvocable: false });
  assert.equal(f.syncCalls(), 2); privateTokenAbsent(f.store, enable.token);
});

test('enable never grants permissions intrinsically denied by the supplier', async t => {
  const f = fixture(t, { summary: { invocation: { modelInvocable: false, userInvocable: false } } });
  assert.equal(f.actions.describe(f.store.get(f.id)).workingStatus, 'disabled');
  const disable = f.actions.prepare({ id: f.id, action: 'disable' }); await f.actions.execute({ token: disable.token });
  const enable = f.actions.prepare({ id: f.id, action: 'enable' }); const result = await f.actions.execute({ token: enable.token });
  assert.equal(result.management.workingStatus, 'disabled');
  assert.deepEqual(f.store.get(f.id).invocation, { modelInvocable: false, userInvocable: false });
  assert.equal(f.store.getControl(f.id).invocationOverride, undefined);
});

test('unknown synthetic definitions, malformed identities and unsupported runtimes are ineligible', async t => {
  const f = fixture(t);
  for (const skill of [null, { ...f.store.get(f.id), id: 'not-an-id' }, { ...f.store.get(f.id), source: 'unknown' },
    { ...f.store.get(f.id), provider: 'unknown' }, { ...f.store.get(f.id), name: '' }]) {
    assert.equal(f.actions.describe(skill).eligible, false, JSON.stringify(skill));
    assert.deepEqual(f.actions.describe(skill).allowedActions, []);
  }
  await rejects(() => f.actions.prepare({ id: '0'.repeat(64), action: 'disable' }), 'protected', 403);
  f.runtime.supported = false;
  assert.equal(f.actions.describe(f.store.get(f.id)).eligible, false);
  await rejects(() => f.actions.prepare({ id: f.id, action: 'disable' }), 'protected', 403);
  assert.deepEqual(f.store.listControls(), []);
});

test('policy actions cannot authorize archive, restore, delete or file-deletion confirmation text', async t => {
  const f = fixture(t), before = rows(f.store);
  for (const action of ['archive', 'restore', 'delete', 'install']) await rejects(() => f.actions.prepare({ id: f.id, action }), 'protected', 403);
  const plan = f.actions.prepare({ id: f.id, action: 'disable' });
  await rejects(() => f.actions.execute({ token: plan.token, confirmationText: summary.name }), 'invalid', 400);
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
});

test('expired and unknown nonces cannot authorize changes, and bounded plans are reclaimed at expiry', async t => {
  const f = fixture(t, { config: { actionMaxPlans: 1 } }), before = rows(f.store);
  const plan = f.actions.prepare({ id: f.id, action: 'disable' });
  await rejects(() => f.actions.prepare({ id: f.id, action: 'disable' }), 'too-many-plans', 429);
  await rejects(() => f.actions.execute({ token: 'unknown-nonce' }), 'expired', 410);
  f.advance(1000);
  await rejects(() => f.actions.execute({ token: plan.token }), 'expired', 410);
  const fresh = f.actions.prepare({ id: f.id, action: 'disable' });
  assert.notEqual(fresh.token, plan.token); assert.notEqual(fresh.operationId, plan.operationId);
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
});

test('a changed identity or competing policy state invalidates a prepared confirmation without audit', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' }), original = f.store.get(f.id);
  f.store.put({ ...original, resourceBase: { kind: 'opaque', description: 'Changed supplier location' } });
  await rejects(() => f.actions.execute({ token: plan.token }), 'conflict', 409);
  assert.equal(f.store.getControl(f.id), null); assert.equal(f.syncCalls(), 0);
  assert.equal(f.actions.operationStatus({ id: f.id, operationId: plan.operationId }).status, 'failed');
  f.store.put(original);
  const fresh = f.actions.prepare({ id: f.id, action: 'disable' });
  f.store.saveControl(f.id, { version: 1, invocationOverride: { disabled: true, at: NOW }, lastOperation: { id: 'other-operation', status: 'succeeded' } }, 'invocation-disabled');
  const before = rows(f.store);
  await rejects(() => f.actions.execute({ token: fresh.token }), 'conflict', 409);
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
});

test('execution-time control CAS rejects a competing journal commit rather than clobbering it', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  const competing = { version: 1, lastOperation: { id: 'other-operation', status: 'succeeded' }, auditNote: 'must survive' };
  let before;
  f.state.saveControl = (...args) => {
    f.store.saveControl(f.id, competing, 'competing-control');
    before = rows(f.store);
    return f.store.saveControl(...args);
  };
  await rejects(() => f.actions.execute({ token: plan.token }), 'conflict', 409);
  assert.deepEqual(f.store.getControl(f.id), competing);
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
  assert.equal(f.actions.operationStatus({ id: f.id, operationId: plan.operationId }).status, 'failed');
});

test('another Host filesystem journal owner blocks policy changes and its recovery receipt remains authoritative', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  const pending = { version: 1, pending: { operationId: 'other-host-operation', phase: 'intent', action: 'archive' }, lastOperation: { id: 'other-host-operation', action: 'archive', status: 'running' } };
  f.store.saveControl(f.id, pending, 'action-intent'); const before = rows(f.store);
  assert.equal(f.actions.describe(f.store.get(f.id)).reasonCode, 'recovery-required');
  await rejects(() => f.actions.execute({ token: plan.token }), 'conflict', 409);
  assert.equal(rows(f.store), before); assert.equal(f.syncCalls(), 0);
  assert.equal(f.actions.operationStatus({ id: f.id, operationId: 'other-host-operation' }).status, 'recovery-required');
});

test('policy overrides are per canonical instance even when another provider exposes the same name', async t => {
  const f = fixture(t), other = { ...summary, provider: 'other-runtime-provider', source: 'runtime' }, otherId = skillId(other);
  f.store.observe([{ contextId: 'other-scope', cwd: null, complete: true, skills: [other] }]);
  const plan = f.actions.prepare({ id: f.id, action: 'disable' }); await f.actions.execute({ token: plan.token });
  assert.equal(f.actions.describe(f.store.get(f.id)).workingStatus, 'disabled');
  assert.equal(f.actions.describe(f.store.get(otherId)).workingStatus, 'enabled');
  assert.equal(f.store.getControl(otherId), null);
  assert.equal(f.store.snapshot().length, 2);
});

test('an unrelated control update is merged, while the direction and execution-time CAS remain authoritative', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  f.store.saveControl(f.id, { version: 1, auditNote: 'new metadata', lastOperation: { id: 'unrelated', status: 'succeeded' } }, 'unrelated-update');
  await f.actions.execute({ token: plan.token });
  assert.equal(f.store.getControl(f.id).auditNote, 'new metadata');
  assert.equal(f.store.getControl(f.id).invocationOverride.disabled, true);
  assert.equal(f.store.getControl(f.id).lastOperation.id, plan.operationId);
});

test('malformed durable overrides are rejected on save and read instead of silently becoming allowed', async t => {
  const f = fixture(t), before = rows(f.store);
  for (const invocationOverride of [null, false, [], {}, { disabled: 'true' }, { disabled: 1 }]) {
    assert.throws(() => f.store.saveControl(f.id, { invocationOverride }, 'invocation-disabled'), /Invalid durable invocation policy/);
    assert.equal(rows(f.store), before);
  }
  f.store.db.prepare('INSERT INTO file_controls VALUES (?,?)').run(f.id, JSON.stringify({ invocationOverride: { disabled: 'false' } }));
  assert.throws(() => f.store.getControl(f.id), /Invalid durable invocation policy/);
  assert.throws(() => f.store.listControls(), /Invalid durable invocation policy/);
  assert.throws(() => f.actions.describe(f.store.get(f.id)), /Invalid durable invocation policy/);
  await assert.rejects(Promise.resolve().then(() => f.actions.prepare({ id: f.id, action: 'disable' })), /Invalid durable invocation policy/);
  assert.equal(f.syncCalls(), 0);
});

test('a policy journal failure leaves the deny uncommitted and never starts runtime synchronization', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' }), before = rows(f.store);
  f.store.db.exec("CREATE TRIGGER policy_audit_failure BEFORE INSERT ON events WHEN NEW.kind='invocation-disabled' BEGIN SELECT RAISE(ABORT, 'fixture policy audit failure'); END");
  await assert.rejects(f.actions.execute({ token: plan.token }), /fixture policy audit failure/);
  assert.equal(rows(f.store), before);
  assert.equal(f.store.getControl(f.id), null);
  assert.equal(f.syncCalls(), 0);
  assert.equal(f.actions.operationStatus({ id: f.id, operationId: plan.operationId }).status, 'failed');
});

test('a fresh controller recovers the last operation receipt from the durable store without resurrecting secret plans', async t => {
  const f = fixture(t), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  await f.actions.execute({ token: plan.token }); await f.actions.dispose();
  const restarted = f.make();
  assert.equal(restarted.describe(f.store.get(f.id)).workingStatus, 'disabled');
  assert.deepEqual(restarted.operationStatus({ id: f.id, operationId: plan.operationId }), { id: f.id, operationId: plan.operationId, action: 'disable', status: 'succeeded' });
  await rejects(() => restarted.execute({ token: plan.token }), 'expired', 410);
  const enable = restarted.prepare({ id: f.id, action: 'enable' }); await restarted.execute({ token: enable.token });
  await restarted.dispose();
  const again = f.make();
  assert.equal(again.operationStatus({ id: f.id, operationId: enable.operationId }).status, 'succeeded');
  assert.equal(again.operationStatus({ id: f.id, operationId: plan.operationId }).status, 'unknown', 'Only the latest durable receipt is promised after restart');
  assert.equal(again.describe(f.store.get(f.id)).workingStatus, 'enabled');
});

test('synchronization failure leaves desired deny committed and returns a health warning, not filesystem rollback', async t => {
  const f = fixture(t, { sync: async () => { throw new Error('fixture scope unavailable'); } });
  const original = f.store.get(f.id), plan = f.actions.prepare({ id: f.id, action: 'disable' });
  const result = await f.actions.execute({ token: plan.token });
  assert.equal(f.store.getControl(f.id).invocationOverride.disabled, true);
  assert.equal(f.store.getControl(f.id).lastOperation.status, 'succeeded');
  assert.equal(result.management.workingStatus, 'disabled');
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /saved.*fail closed/i);
  assert.equal(f.reports[0][0], 'policy-sync-incomplete');
  assert.equal(f.store.detail(f.id).events[0].kind, 'invocation-disabled');
  assert.deepEqual(f.store.get(f.id), original);
  await rejects(() => f.actions.execute({ token: plan.token }), 'expired', 410);
});

test('dispose waits for admitted synchronization, invalidates unused plans and rejects later execution', async t => {
  const started = deferred(), release = deferred();
  const f = fixture(t, { sync: async () => { started.resolve(); await release.promise; } });
  const plan = f.actions.prepare({ id: f.id, action: 'disable' }), unused = f.actions.prepare({ id: f.id, action: 'disable' });
  const operation = f.actions.execute({ token: plan.token });
  await started.promise;
  let disposed = false;
  const disposal = f.actions.dispose().then(() => { disposed = true; });
  await Promise.resolve(); assert.equal(disposed, false);
  assert.equal(f.store.getControl(f.id).invocationOverride.disabled, true);
  await rejects(() => f.actions.execute({ token: unused.token }), 'disposed', 410);
  await rejects(() => f.actions.prepare({ id: f.id, action: 'enable' }), 'disposed', 410);
  release.resolve();
  await operation; await disposal;
  assert.equal(disposed, true);
});

async function serviceFixture(t, { supported = true, failingSync = false, withRuntime = true } = {}) {
  let observers, attached = 0, detached = 0, disposed = 0, syncCalls = 0, desired;
  const adapter = {
    discover: async () => ({ contexts: [{ id: 'fixture-scope', label: 'Fixture', cwd: null }], observations: [{ contextId: 'fixture-scope', complete: true, skills: [summary] }], warnings: [] }),
    attach: value => { observers = value; return () => {}; },
  };
  const manager = createSkillManager({ adapter, filename: ':memory:', config: resolveConfig({ scanIntervalMs: 86400000, debounceMs: 60000 }),
    invocationRuntimeFactory: withRuntime ? ({ disabled }) => {
      desired = disabled;
      return { supported, sync: async () => { syncCalls++; if (failingSync) throw new Error('fixture synchronization failed'); }, attach: () => { attached++; return () => { detached++; }; }, dispose: async () => { disposed++; } };
    } : undefined,
    probe: async () => assert.fail('A virtual skill must not trigger any filesystem probe'),
  });
  t.after(() => manager.dispose());
  await manager.refresh();
  return { manager, id: manager.snapshot().skills[0].id, observers: () => observers, desired: () => desired(), syncCalls: () => syncCalls, lifecycle: () => ({ attached, detached, disposed }) };
}

test('service routes virtual owner actions to policy mode without filesystem probes, changing identity, groups or usage', async t => {
  const f = await serviceFixture(t), { manager, id } = f;
  f.observers().invocation({ eventKey: 'skill:fixture:original-call', name: summary.name, provider: summary.provider, resourceBase: summary.resourceBase,
    at: NOW, actor: { kind: 'agent', id: 'fixture', label: 'Fixture agent' }, outcome: 'success', channel: 'tool' });
  const before = manager.detail(id), beforeGroups = manager.snapshot().groups;
  assert.equal(before.skill.usage.total, 1);
  assert.equal(before.skill.management.mode, 'override');
  assert.deepEqual(before.skill.management.allowedActions, ['disable']);
  const plan = await manager.prepareAction({ id, action: 'disable' }); policyPlan(plan, id, 'disable');
  assert.equal(manager.actionStatus({ id, operationId: plan.operationId }).status, 'not-started');
  assert.equal(manager.detail(id).total, before.total);
  assert.ok(!JSON.stringify(manager.snapshot()).includes(plan.token));
  await manager.executeAction({ token: plan.token });
  assert.deepEqual(f.desired().map(skill => skill.id), [id]);
  assert.equal(manager.detail(id).skill.management.workingStatus, 'disabled');
  assert.deepEqual(manager.detail(id).skill.usage, before.skill.usage);
  assert.deepEqual(manager.snapshot().groups, beforeGroups);
  await manager.refresh();
  assert.equal(manager.detail(id).skill.id, id);
  assert.equal(manager.detail(id).skill.management.mode, 'override');
  assert.ok(manager.detail(id).events.some(event => event.kind === 'invocation-disabled'));
  for (const event of before.events) assert.ok(manager.detail(id).events.some(value => value.id === event.id));
  for (const action of ['archive', 'delete', 'restore']) await rejects(() => manager.prepareAction({ id, action }), 'protected', 403);
  const enable = await manager.prepareAction({ id, action: 'enable' }); await manager.executeAction({ token: enable.token });
  assert.deepEqual(f.desired(), []);
  assert.deepEqual(manager.detail(id).skill.invocation, summary.invocation);
  assert.deepEqual(manager.detail(id).skill.usage, before.skill.usage);
  assert.equal(f.syncCalls(), 2);
  assert.equal(manager.actionStatus({ id, operationId: enable.operationId }).status, 'succeeded');
  await rejects(() => manager.executeAction({ token: enable.token }), 'expired', 410);
  await manager.dispose();
  assert.deepEqual(f.lifecycle(), { attached: 1, detached: 1, disposed: 1 });
});

test('service reports synchronization failure without clearing its durable desired restriction', async t => {
  const f = await serviceFixture(t, { failingSync: true }), plan = await f.manager.prepareAction({ id: f.id, action: 'disable' });
  const result = await f.manager.executeAction({ token: plan.token });
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(f.desired().map(skill => skill.id), [f.id]);
  assert.equal(f.manager.detail(f.id).skill.management.workingStatus, 'disabled');
  assert.ok(f.manager.snapshot().warnings.some(warning => warning.code === 'policy-sync-incomplete'));
});

test('service without a supported runtime never advertises a pretend virtual toggle', async t => {
  for (const options of [{ supported: false }, { withRuntime: false }]) {
    const f = await serviceFixture(t, options);
    assert.equal(f.manager.detail(f.id).skill.management.eligible, false);
    assert.deepEqual(f.manager.detail(f.id).skill.management.allowedActions, []);
    await rejects(() => f.manager.prepareAction({ id: f.id, action: 'disable' }), 'protected', 403);
    assert.equal(f.syncCalls(), 0);
  }
});
