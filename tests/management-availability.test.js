import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { SkillStore, skillId } from '../src/store.js';
import { createPolicyActions } from '../src/policy-actions.js';
import { createSkillManager } from '../src/service.js';
import { resolveConfig } from '../src/config.js';
import { configuredStatus, withAvailability } from '../src/management-availability.js';

const NAME = 'availability-fixture';
const TEXT = `---\nname: ${NAME}\ndescription: Owned test fixture\n---\n\nFixture instruction body.\n`;
const VIRTUAL = { name: NAME, provider: 'fixture-runtime', source: 'runtime', path: null, description: 'Virtual fixture',
  resourceBase: { kind: 'opaque', description: 'Fixture resources' }, invocation: { modelInvocable: true, userInvocable: true } };
const rejectedUnavailable = operation => assert.rejects(Promise.resolve().then(operation), error => [403, 409].includes(error.status));

async function owned(t) {
  const root = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(root, 'dsh-management-availability-')));
  const verify = async () => {
    assert.ok(isAbsolute(directory)); assert.equal(resolve(directory), directory);
    assert.equal(join(root, basename(directory)), directory);
    assert.ok(basename(directory).startsWith('dsh-management-availability-'));
    assert.ok(directory.startsWith(root + sep)); assert.equal(await realpath(directory), directory);
  };
  await verify();
  t.after(async () => { await verify(); await rm(directory, { recursive: true, force: true }); });
  const removeFile = async path => {
    await verify(); assert.ok(isAbsolute(path)); assert.ok(path.startsWith(directory + sep));
    assert.equal(path, resolve(path)); assert.equal(await realpath(path), path);
    assert.equal(basename(path), 'SKILL.md');
    await unlink(path);
  };
  return { directory, verify, removeFile };
}
async function managerFixture(t, { local = false, packaged = false, present = true } = {}) {
  const fs = await owned(t);
  const skillDirectory = join(fs.directory, ...(packaged ? ['node_modules', 'fixture-package', 'skills'] : ['skills']), NAME);
  const path = local ? join(skillDirectory, 'SKILL.md') : null;
  if (local) {
    await mkdir(skillDirectory, { recursive: true });
    if (present) { await writeFile(path, TEXT); await writeFile(join(skillDirectory, 'resource.txt'), 'owned resource'); }
  }
  const summary = local ? { name: NAME, provider: packaged ? 'fixture-package' : 'filesystem', source: packaged ? 'bundled' : 'custom', description: 'Owned fixture', path,
    resourceBase: { kind: 'directory', path: skillDirectory }, invocation: { modelInvocable: true, userInvocable: true } } : VIRTUAL;
  let visible = true, syncCalls = 0, desired;
  const adapter = {
    discover: async () => ({ contexts: [{ id: 'fixture', cwd: fs.directory, label: 'Fixture' }], observations: [{ contextId: 'fixture', complete: true, skills: visible ? [summary] : [] }], warnings: [] }),
    attach: () => () => {},
  };
  const manager = createSkillManager({ adapter, filename: ':memory:', config: resolveConfig({ scanIntervalMs: 86400000, debounceMs: 60000 }),
    invocationRuntimeFactory: ({ disabled }) => {
      desired = disabled;
      return { supported: true, sync: async () => { syncCalls++; }, attach: () => () => {}, dispose: async () => {} };
    },
  });
  t.after(() => manager.dispose());
  await manager.refresh();
  const id = skillId(summary);
  const execute = async plan => {
    // File lifecycle plans may move/purge this owned fixture, never any other path.
    await fs.verify();
    if (plan.mode !== 'override') { assert.ok(plan.path.startsWith(fs.directory + sep)); assert.equal(await realpath(plan.path), resolve(plan.path)); }
    return manager.executeAction({ token: plan.token, ...(plan.action === 'delete' ? { confirmationText: NAME } : {}) });
  };
  return { ...fs, manager, id, path, skillDirectory, summary, visible: value => { visible = value; }, syncCalls: () => syncCalls, desired: () => desired(),
    row: () => manager.detail(id).skill, events: () => manager.detail(id).events, execute };
}
function unavailable(row, configured) {
  assert.equal(row.management.workingStatus, 'unavailable');
  assert.equal(row.management.configuredWorkingStatus, configured);
  assert.deepEqual(row.management.allowedActions, []);
}

test('configured preference is independent of presence and gives a saved manager deny precedence', () => {
  assert.equal(configuredStatus({ ...VIRTUAL, status: 'missing' }, null), 'enabled');
  assert.equal(configuredStatus(VIRTUAL, { invocationOverride: { disabled: true } }, { workingStatus: 'enabled' }), 'disabled');
  assert.equal(configuredStatus(VIRTUAL, { disabledPolicy: { original: 'retained' } }), 'disabled');
  assert.equal(configuredStatus({ ...VIRTUAL, invocation: { modelInvocable: false, userInvocable: false } }, null), 'disabled');
  assert.equal(configuredStatus({ ...VIRTUAL, invocation: undefined }, null), 'unknown');
});

test('availability decoration preserves preference, recovery reasons and archive-only actions without mutating inputs', () => {
  const capability = { eligible: true, workingStatus: 'enabled', configuredWorkingStatus: 'enabled', fileStatus: 'active', allowedActions: ['disable', 'archive', 'delete'], reasonCode: null, reason: null };
  const original = structuredClone(capability);
  const missing = withAvailability({ ...VIRTUAL, status: 'missing' }, capability);
  assert.equal(missing.workingStatus, 'unavailable'); assert.equal(missing.configuredWorkingStatus, 'enabled');
  assert.equal(missing.eligible, false); assert.deepEqual(missing.allowedActions, []); assert.equal(missing.fileStatus, 'missing');
  const archived = withAvailability({ ...VIRTUAL, status: 'missing' }, { ...capability, fileStatus: 'archived', allowedActions: ['enable', 'restore', 'delete'] });
  assert.equal(archived.workingStatus, 'unavailable'); assert.equal(archived.eligible, true); assert.deepEqual(archived.allowedActions, ['restore', 'delete']);
  const deleted = withAvailability({ ...VIRTUAL, status: 'present' }, { ...capability, fileStatus: 'deleted' });
  assert.equal(deleted.workingStatus, 'unavailable'); assert.deepEqual(deleted.allowedActions, []);
  const unknown = withAvailability({ ...VIRTUAL, status: 'unknown' }, capability);
  assert.equal(unknown.workingStatus, 'unknown'); assert.deepEqual(unknown.allowedActions, []);
  const recovery = withAvailability({ ...VIRTUAL, status: 'missing' }, { ...capability, reasonCode: 'recovery-required', reason: 'Preserve recovery instructions' });
  assert.equal(recovery.reasonCode, 'recovery-required'); assert.equal(recovery.reason, 'Preserve recovery instructions');
  assert.deepEqual(withAvailability({ ...VIRTUAL, status: 'present' }, capability), capability);
  assert.deepEqual(capability, original);
});

for (const status of ['missing', 'unavailable', 'unknown']) {
  test(`policy controller cannot advertise or prepare toggles for a ${status} definition`, async t => {
    const store = new SkillStore(':memory:');
    store.observe([{ contextId: 'fixture', cwd: null, complete: true, skills: [{ ...VIRTUAL, file: { status } }] }]);
    const id = skillId(VIRTUAL);
    const state = { get: key => store.get(key), getControl: key => store.getControl(key), listControls: () => store.listControls(), saveControl: (...args) => store.saveControl(...args) };
    let syncCalls = 0;
    const actions = createPolicyActions({ state, runtime: { supported: true, sync: async () => { syncCalls++; } } });
    t.after(async () => { await actions.dispose(); store.close(); });
    const capability = actions.describe(store.get(id));
    assert.equal(capability.eligible, false);
    assert.equal(capability.workingStatus, status === 'unknown' ? 'unknown' : 'unavailable');
    assert.equal(capability.configuredWorkingStatus, 'enabled');
    assert.deepEqual(capability.allowedActions, []);
    await rejectedUnavailable(() => actions.prepare({ id, action: 'disable' }));
    await rejectedUnavailable(() => actions.prepare({ id, action: 'enable' }));
    assert.equal(store.getControl(id), null); assert.equal(store.detail(id).total, 1); assert.equal(syncCalls, 0);
  });
}

test('missing custom files do not fall back to an enabled policy override despite stale enabled provider flags', async t => {
  const f = await managerFixture(t, { local: true, present: false });
  assert.equal(f.row().status, 'missing'); unavailable(f.row(), 'enabled');
  const before = f.events();
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'disable' }));
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'enable' }));
  assert.deepEqual(f.events(), before); assert.equal(f.syncCalls(), 0); assert.deepEqual(f.desired(), []);
  await writeFile(f.path, TEXT); await f.manager.refresh();
  assert.equal(f.row().id, f.id); assert.equal(f.row().management.workingStatus, 'enabled');
  assert.ok(f.row().management.allowedActions.includes('disable'));
});

test('missing packaged files preserve a saved deny and separately report its configured disabled state', async t => {
  const f = await managerFixture(t, { local: true, packaged: true });
  assert.equal(f.row().management.mode, 'override');
  const plan = await f.manager.prepareAction({ id: f.id, action: 'disable' }); await f.execute(plan);
  assert.deepEqual(f.desired().map(skill => skill.id), [f.id]);
  const receipt = f.events().find(event => event.kind === 'invocation-disabled');
  await f.removeFile(f.path); await f.manager.refresh();
  assert.equal(f.row().status, 'missing'); unavailable(f.row(), 'disabled');
  assert.deepEqual(f.desired().map(skill => skill.id), [f.id]);
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'enable' }));
  assert.ok(f.events().some(event => event.id === receipt.id)); assert.equal(f.syncCalls(), 1);
  await writeFile(f.path, TEXT); await f.manager.refresh();
  assert.equal(f.row().management.workingStatus, 'disabled'); assert.deepEqual(f.row().management.allowedActions, ['enable']);
  assert.deepEqual(f.desired().map(skill => skill.id), [f.id]);
});

test('virtual disappearance becomes unavailable in the same refresh, rather than using a pre-observation enabled cache', async t => {
  const f = await managerFixture(t);
  assert.equal(f.row().status, 'present'); assert.equal(f.row().management.workingStatus, 'enabled');
  const before = f.events();
  f.visible(false); const refreshed = await f.manager.refresh();
  assert.equal(refreshed.skills[0].status, 'unavailable'); unavailable(refreshed.skills[0], 'enabled');
  unavailable(f.row(), 'enabled');
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'disable' }));
  assert.equal(f.syncCalls(), 0);
  for (const event of before) assert.ok(f.events().some(value => value.id === event.id));
  f.visible(true); await f.manager.refresh();
  assert.equal(f.row().id, f.id); assert.equal(f.row().status, 'present');
  assert.equal(f.row().management.workingStatus, 'enabled');
  const plan = await f.manager.prepareAction({ id: f.id, action: 'disable' }); await f.execute(plan);
  assert.equal(f.row().management.workingStatus, 'disabled');
});

test('virtual disappearance retains configured manager deny and reappearance permits removing it', async t => {
  const f = await managerFixture(t), plan = await f.manager.prepareAction({ id: f.id, action: 'disable' }); await f.execute(plan);
  f.visible(false); await f.manager.refresh(); unavailable(f.row(), 'disabled');
  assert.deepEqual(f.desired().map(skill => skill.id), [f.id]);
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'enable' }));
  f.visible(true); await f.manager.refresh();
  assert.equal(f.row().management.workingStatus, 'disabled');
  const enable = await f.manager.prepareAction({ id: f.id, action: 'enable' }); await f.execute(enable);
  assert.equal(f.row().management.workingStatus, 'enabled'); assert.deepEqual(f.desired(), []);
});

test('a protected package file disappearing before prepare is freshly rejected without policy audit or synchronization', async t => {
  const f = await managerFixture(t, { local: true, packaged: true });
  assert.equal(f.row().management.workingStatus, 'enabled');
  const before = f.events();
  await f.removeFile(f.path); // Intentionally no refresh: the cached catalog still says present.
  await rejectedUnavailable(() => f.manager.prepareAction({ id: f.id, action: 'disable' }));
  assert.deepEqual(f.events(), before); assert.deepEqual(f.desired(), []); assert.equal(f.syncCalls(), 0);
});

test('a protected package file disappearing between prepare and execute cannot commit a policy restriction', async t => {
  const f = await managerFixture(t, { local: true, packaged: true });
  const plan = await f.manager.prepareAction({ id: f.id, action: 'disable' }); assert.equal(plan.mode, 'override');
  const before = f.events();
  await f.removeFile(f.path);
  await rejectedUnavailable(() => f.execute(plan));
  assert.deepEqual(f.events(), before); assert.deepEqual(f.desired(), []); assert.equal(f.syncCalls(), 0);
  await assert.rejects(f.manager.executeAction({ token: plan.token }), error => error.status === 410);
});

test('a disappearing package file cannot clear an existing deny with a previously prepared enable', async t => {
  const f = await managerFixture(t, { local: true, packaged: true });
  const disable = await f.manager.prepareAction({ id: f.id, action: 'disable' }); await f.execute(disable);
  const enable = await f.manager.prepareAction({ id: f.id, action: 'enable' }), before = f.events();
  await f.removeFile(f.path);
  await rejectedUnavailable(() => f.execute(enable));
  assert.deepEqual(f.events(), before); assert.deepEqual(f.desired().map(skill => skill.id), [f.id]); assert.equal(f.syncCalls(), 1);
});

test('archive still permits restore and permanent delete when the original file is missing; absence never clears history', async t => {
  const f = await managerFixture(t, { local: true });
  const before = f.events(), archive = await f.manager.prepareAction({ id: f.id, action: 'archive' }); await f.execute(archive);
  f.visible(false); await f.manager.refresh();
  assert.equal(f.row().status, 'missing');
  assert.equal(f.row().management.workingStatus, 'unavailable');
  assert.equal(f.row().management.fileStatus, 'archived');
  assert.deepEqual(f.row().management.allowedActions, ['restore', 'delete']);
  const restore = await f.manager.prepareAction({ id: f.id, action: 'restore' }); await f.execute(restore);
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  assert.equal(await readFile(join(f.skillDirectory, 'resource.txt'), 'utf8'), 'owned resource');
  f.visible(true); await f.manager.refresh();
  assert.equal(f.row().management.workingStatus, 'enabled');
  const secondArchive = await f.manager.prepareAction({ id: f.id, action: 'archive' }); await f.execute(secondArchive);
  await f.manager.refresh();
  const deletion = await f.manager.prepareAction({ id: f.id, action: 'delete' }); await f.execute(deletion);
  await f.manager.refresh();
  assert.equal(f.row().management.workingStatus, 'unavailable');
  assert.equal(f.row().management.fileStatus, 'deleted'); assert.deepEqual(f.row().management.allowedActions, []);
  await assert.rejects(stat(f.skillDirectory), { code: 'ENOENT' });
  for (const event of before) assert.ok(f.events().some(value => value.id === event.id));
  assert.equal(f.row().id, f.id); assert.equal(f.row().usage.total, 0);
});
