import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, lstat, readdir, rm, symlink, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFileActions } from '../src/file-actions.js';

const ID = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const TEXT = '---\n# keep frontmatter comment\nname: example\ndescription: "Keep: quoted"\ncustom:\n  nested: 42 # nested comment\ndisable-model-invocation: false # model comment\nuser-invocable: true # user comment\n---\nBody is byte-for-byte preserved.\n\n```js\nconst value = 1;\n```\n';
const BODY = TEXT.slice(TEXT.indexOf('---\n', 4) + 4);
const config = { actionTokenTtlMs: 120000, actionMaxFiles: 100, actionMaxBytes: 1048576, maxFileBytes: 1048576, observationCacheSize: 30 };
const code = (wanted, status) => error => error.code === wanted && (status === undefined || error.status === status);
async function present(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

async function fixture(t, { flat = false, folder = 'example', resourceBase = true, settings = {}, source = 'custom', provider = 'filesystem' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-file-actions-test-'))), controllers = [];
  const tempRoot = await realpath(tmpdir());
  assert.ok(root.startsWith(tempRoot + sep) && root.includes('dsh-file-actions-test-'));
  const parent = join(root, 'skills'), directory = flat ? parent : join(parent, folder);
  await mkdir(directory, { recursive: true });
  const path = join(directory, flat ? 'example.md' : 'SKILL.md');
  await writeFile(path, TEXT);
  const records = new Map([[ID, { id: ID, name: 'example', provider, source, description: 'Fixture', path,
    ...(resourceBase ? { resourceBase: { kind: 'directory', path: directory } } : {}) }]]);
  const controls = new Map(), events = [];
  const state = {
    get: id => structuredClone(records.get(id) ?? null),
    getControl: id => structuredClone(controls.get(id) ?? null),
    listControls: () => [...controls].map(([id, control]) => ({ id, control: structuredClone(control) })),
    saveControl(id, control, eventKind, details, actor, expectedControl) {
      state.onSave?.(id, control, eventKind, details, expectedControl);
      const current = controls.get(id) ?? {};
      if (expectedControl !== undefined && JSON.stringify(current) !== JSON.stringify(expectedControl)) throw Object.assign(Error('Concurrent lifecycle change'), { code: 'conflict', status: 409 });
      if (current.pending && current.pending.operationId !== (control.pending?.operationId ?? control.lastOperation?.id)) throw Object.assign(Error('Another operation owns the journal'), { code: 'conflict', status: 409 });
      controls.set(id, structuredClone(control)); events.push(structuredClone({ id, eventKind, details, actor, control }));
    },
  };
  let time = Date.parse('2026-11-08T00:00:00.000Z');
  const make = extra => { const value = createFileActions({ state, config: { ...config, ...settings }, now: () => new Date(time).toISOString(), ...extra }); controllers.push(value); return value; };
  const actions = make();
  t.after(async () => {
    for (const controller of controllers) await controller.dispose();
    // Only this exact unique root, created by this fixture, is deleted.
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(tempRoot + sep) && root.includes('dsh-file-actions-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, parent, directory, path, records, controls, events, state, actions, make, advance: ms => { time += ms; } };
}
async function perform(f, action, id = ID) {
  const plan = await f.actions.prepare({ id, action });
  const result = await f.actions.execute({ token: plan.token, ...(action === 'delete' ? { confirmationText: plan.name } : {}) });
  return { plan, result };
}

test('disable and enable preserve instruction body, comments and original invocation flags', async t => {
  const f = await fixture(t);
  const disabled = await perform(f, 'disable');
  assert.equal(disabled.plan.targetKind, 'file');
  assert.equal(disabled.result.management.workingStatus, 'disabled');
  const text = await readFile(f.path, 'utf8');
  assert.deepEqual(disabled.result.writeEvidence, { path: f.path, contentHash: createHash('sha256').update(text).digest('hex') });
  assert.match(text, /disable-model-invocation: true # model comment/);
  assert.match(text, /user-invocable: false # user comment/);
  assert.ok(text.endsWith(BODY));
  assert.ok(text.includes('# keep frontmatter comment') && text.includes('nested: 42 # nested comment'));
  await assert.rejects(f.actions.prepare({ id: ID, action: 'disable' }), code('conflict', 409));
  const enabled = await perform(f, 'enable');
  assert.equal(enabled.result.management.workingStatus, 'enabled');
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  assert.equal(f.controls.get(ID).disabledPolicy, undefined);
  assert.ok(f.events.every(event => event.actor.kind === 'user' && event.actor.label === 'Owner UI'));
  assert.ok(!JSON.stringify(f.events).includes(disabled.plan.token));
});

test('enable removes manager-added flags and explicitly permits externally disabled skills', async t => {
  const f = await fixture(t);
  const without = TEXT.replace('disable-model-invocation: false # model comment\n', '').replace('user-invocable: true # user comment\n', '');
  await writeFile(f.path, without);
  await perform(f, 'disable'); await perform(f, 'enable');
  assert.equal(await readFile(f.path, 'utf8'), without);
  await writeFile(f.path, without.replace('description:', 'disable-model-invocation: true\nuser-invocable: false\ndescription:'));
  await perform(f, 'enable');
  assert.equal((await f.actions.describe(f.state.get(ID))).workingStatus, 'enabled');
});

test('policy edits retain CRLF instruction bodies', async t => {
  const f = await fixture(t), text = TEXT.replaceAll('\n', '\r\n');
  await writeFile(f.path, text); await perform(f, 'disable'); await perform(f, 'enable');
  assert.equal(await readFile(f.path, 'utf8'), text);
});

test('archive owned directory includes resources outside one-level skill discovery and restores them exclusively', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'scripts')); await writeFile(join(f.directory, 'scripts', 'helper.py'), 'print("owned fixture")\n');
  const { plan, result } = await perform(f, 'archive');
  assert.equal(plan.targetKind, 'directory'); assert.equal(plan.fileCount, 2);
  assert.equal(result.management.fileStatus, 'archived');
  const archive = f.controls.get(ID).archive;
  assert.ok(archive.path.startsWith(join(f.parent, '.dsh-skill-manager-archive', ID) + sep));
  assert.equal(archive.path.split(sep).at(-1), 'payload');
  assert.equal(await present(f.directory), false);
  assert.equal(await readFile(join(archive.path, 'scripts', 'helper.py'), 'utf8'), 'print("owned fixture")\n');
  assert.deepEqual((await f.actions.describe(f.state.get(ID))).allowedActions, ['restore', 'delete']);
  const restored = await perform(f, 'restore');
  assert.equal(restored.result.management.fileStatus, 'active');
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  assert.equal(await readFile(join(f.directory, 'scripts', 'helper.py'), 'utf8'), 'print("owned fixture")\n');
  assert.equal(await present(archive.path), false);
});

test('flat files and ambiguous directory ownership never claim shared resources', async t => {
  for (const options of [{ flat: true }, { folder: 'shared-directory' }, { resourceBase: false }]) {
    const f = await fixture(t, options), sibling = join(f.directory, 'shared.txt');
    await writeFile(sibling, 'must remain');
    const { plan } = await perform(f, 'archive');
    assert.equal(plan.targetKind, 'file'); assert.equal(plan.fileCount, 1); assert.ok(plan.warnings.length);
    assert.equal(await readFile(sibling, 'utf8'), 'must remain');
    await perform(f, 'restore'); assert.equal(await readFile(f.path, 'utf8'), TEXT);
  }
});

test('restore collision never overwrites the new destination and keeps recoverable archive', async t => {
  const f = await fixture(t, { flat: true }); await perform(f, 'archive');
  const plan = await f.actions.prepare({ id: ID, action: 'restore' });
  await writeFile(f.path, 'a new owner file');
  await assert.rejects(f.actions.execute({ token: plan.token }), code('conflict', 409));
  assert.equal(await readFile(f.path, 'utf8'), 'a new owner file');
  assert.equal(await readFile(f.controls.get(ID).archive.path, 'utf8'), TEXT);
  assert.equal(f.controls.get(ID).pending, undefined);
});

test('permanent deletion requires exact confirmation and purges only the private claimed payload', async t => {
  const f = await fixture(t), sibling = join(f.parent, 'other.md'); await writeFile(sibling, 'unrelated');
  const plan = await f.actions.prepare({ id: ID, action: 'delete' });
  assert.equal(plan.confirmationText, 'example');
  assert.notEqual(plan.operationId, plan.token);
  await assert.rejects(f.actions.execute({ token: plan.token, confirmationText: 'Example' }), code('invalid', 400));
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  const result = await f.actions.execute({ token: plan.token, confirmationText: 'example' });
  assert.equal(result.management.fileStatus, 'deleted');
  assert.equal(await present(f.directory), false);
  assert.equal(await readFile(sibling, 'utf8'), 'unrelated');
  const phases = f.events.map(event => event.details.phase).filter(Boolean);
  assert.deepEqual(phases, ['claimed', 'purge-authorized']);
  assert.equal(f.controls.get(ID).pending, undefined);
  assert.equal(f.controls.get(ID).lastOperation.status, 'succeeded');
});

test('archived skills can be permanently deleted without touching a later original-path file', async t => {
  const f = await fixture(t, { flat: true }); await perform(f, 'archive');
  await writeFile(f.path, 'new unrelated occupant');
  await perform(f, 'delete');
  assert.equal(await readFile(f.path, 'utf8'), 'new unrelated occupant');
  assert.equal((await f.actions.describe(f.state.get(ID))).fileStatus, 'deleted');
});

test('bundled/runtime/plugin/unknown providers and virtual entries are protected', async t => {
  const f = await fixture(t);
  for (const change of [{ source: 'bundled' }, { source: 'runtime' }, { source: 'plugin' }, { source: 'unknown' }, { provider: 'remote' }, { path: null }]) {
    const skill = { ...f.state.get(ID), ...change };
    assert.equal((await f.actions.describe(skill)).eligible, false);
    f.records.set(OTHER, { ...skill, id: OTHER });
    await assert.rejects(f.actions.prepare({ id: OTHER, action: 'delete' }), code('protected', 403));
  }
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
});

test('custom additional filesystem provider is allowed only by explicit host configuration', async t => {
  const f = await fixture(t, { provider: 'other-filesystem', settings: { additionalFilesystemProviders: ['other-filesystem'] } });
  assert.equal((await f.actions.describe(f.state.get(ID))).eligible, true);
});

test('node_modules, asar trees, configured protected roots and nested packaged resources are protected', async t => {
  const f = await fixture(t);
  for (const component of ['node_modules', 'app.asar', 'app.asar.unpacked']) {
    const directory = join(f.root, component, 'example'); await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'SKILL.md'), TEXT);
    const skill = { ...f.state.get(ID), path: join(directory, 'SKILL.md'), resourceBase: { kind: 'directory', path: directory } };
    assert.equal((await f.actions.describe(skill)).reasonCode, 'protected');
  }
  const configured = f.make({ protectedRoots: [f.directory] });
  assert.equal((await configured.describe(f.state.get(ID))).reasonCode, 'protected');
  const configRoot = createFileActions({ state: f.state, config: { ...config, protectedSkillDirs: [f.directory] } });
  assert.equal((await configRoot.describe(f.state.get(ID))).reasonCode, 'protected'); await configRoot.dispose();
  await mkdir(join(f.directory, 'resources')); await writeFile(join(f.directory, 'resources', 'package.json'), JSON.stringify({ dsh: { bundle: { patch: 'plugin.yml' } } }));
  await assert.rejects(f.actions.prepare({ id: ID, action: 'archive' }), code('protected', 403));
});

test('ancestor plugin package metadata protects custom skills but dsh.profile alone does not', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }));
  assert.equal((await f.actions.describe(f.state.get(ID))).eligible, true);
  for (const dsh of [{ bundle: { patch: 'plugin.yml' } }, { client: { platform: 'web' } }]) {
    await writeFile(join(f.root, 'package.json'), JSON.stringify({ dsh }));
    await assert.rejects(f.actions.prepare({ id: ID, action: 'archive' }), code('protected', 403));
  }
});

test('symlink and hard-link aliases are rejected before journaling or mutations', async t => {
  const f = await fixture(t), resource = join(f.directory, 'resource.txt');
  await writeFile(resource, 'resource'); await link(resource, join(f.root, 'linked-resource'));
  await assert.rejects(f.actions.prepare({ id: ID, action: 'archive' }), code('protected', 403));
  const flat = await fixture(t, { flat: true });
  const alias = join(flat.root, 'alias'); await symlink(flat.parent, alias);
  flat.records.set(ID, { ...flat.state.get(ID), path: join(alias, 'example.md') });
  await assert.rejects(flat.actions.prepare({ id: ID, action: 'disable' }), code('protected', 403));
  assert.equal(flat.events.length, 0);
});

test('stale plans and pathname swaps conflict without touching either file', async t => {
  const f = await fixture(t, { flat: true }), plan = await f.actions.prepare({ id: ID, action: 'delete' });
  await writeFile(f.path, TEXT + 'changed');
  await assert.rejects(f.actions.execute({ token: plan.token, confirmationText: plan.name }), code('conflict', 409));
  assert.equal(await readFile(f.path, 'utf8'), TEXT + 'changed'); assert.equal(f.events.length, 0);
  const another = await f.actions.prepare({ id: ID, action: 'archive' }), original = join(f.root, 'original.md');
  assert.ok(f.path.startsWith(f.root + sep) && original.startsWith(f.root + sep));
  await rename(f.path, original); await symlink(original, f.path);
  await assert.rejects(f.actions.execute({ token: another.token }), code('protected', 403));
  assert.equal(await readFile(original, 'utf8'), TEXT + 'changed');
});

test('bounded trees and changed resources do not produce destructive partial operations', async t => {
  const limited = await fixture(t, { settings: { actionMaxFiles: 1 } });
  await writeFile(join(limited.directory, 'extra.txt'), 'extra');
  await assert.rejects(limited.actions.prepare({ id: ID, action: 'archive' }), code('limit', 400));
  const bytes = await fixture(t, { settings: { actionMaxBytes: 1 } });
  await assert.rejects(bytes.actions.prepare({ id: ID, action: 'delete' }), code('limit', 400));
  const f = await fixture(t); await writeFile(join(f.directory, 'resource.txt'), 'first');
  const plan = await f.actions.prepare({ id: ID, action: 'archive' }); await writeFile(join(f.directory, 'resource.txt'), 'other');
  await assert.rejects(f.actions.execute({ token: plan.token }), code('conflict', 409));
  assert.equal(await readFile(f.path, 'utf8'), TEXT); assert.equal(f.events.length, 0);
});

test('journal refusal before intent leaves original files and parents unchanged', async t => {
  const f = await fixture(t), plan = await f.actions.prepare({ id: ID, action: 'archive' });
  f.state.onSave = () => { throw Error('owned fixture database unavailable'); };
  await assert.rejects(f.actions.execute({ token: plan.token }), code('journal-failed', 500));
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  assert.deepEqual(await readdir(f.parent), ['example']);
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'failed');
});

test('a failure after claim preserves all bytes in quarantine and blocks further changes across restart', async t => {
  const f = await fixture(t), plan = await f.actions.prepare({ id: ID, action: 'archive' });
  f.state.onSave = (_id, _control, kind, details) => { if (kind === 'action-phase' && details.phase === 'claimed') throw Error('fixture phase write failed'); };
  await assert.rejects(f.actions.execute({ token: plan.token }), code('recovery-required', 409));
  const pending = f.controls.get(ID).pending;
  assert.equal(await readFile(join(pending.destination, 'SKILL.md'), 'utf8'), TEXT);
  assert.equal(await present(f.directory), false);
  assert.equal((await f.actions.describe(f.state.get(ID))).reasonCode, 'recovery-required');
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'recovery-required');
  const restarted = f.make();
  assert.equal(restarted.operationStatus({ id: ID, operationId: plan.operationId }).status, 'recovery-required');
  await assert.rejects(restarted.prepare({ id: ID, action: 'restore' }), code('recovery-required', 409));
});

test('status is owner-readable without execute authority; expired and unloaded plans never execute', async t => {
  const f = await fixture(t), plan = await f.actions.prepare({ id: ID, action: 'archive' });
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'not-started');
  assert.equal(f.actions.operationStatus({ id: OTHER, operationId: plan.operationId }).status, 'unknown');
  f.advance(120001);
  await assert.rejects(f.actions.execute({ token: plan.token }), code('expired', 410));
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  const fresh = await f.actions.prepare({ id: ID, action: 'archive' }); await f.actions.dispose();
  await assert.rejects(f.actions.execute({ token: fresh.token }), code('disposed', 410));
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
});

test('partial invocation surfaces remain enabled and manager enable restores only their original permission', async t => {
  for (const [model, user] of [[true, true], [false, false]]) {
    const f = await fixture(t), text = TEXT.replace('disable-model-invocation: false', `disable-model-invocation: ${model}`).replace('user-invocable: true', `user-invocable: ${user}`);
    await writeFile(f.path, text);
    assert.equal((await f.actions.describe(f.state.get(ID))).workingStatus, 'enabled');
    assert.ok((await f.actions.describe(f.state.get(ID))).allowedActions.includes('disable'));
    const { plan } = await perform(f, 'disable');
    assert.ok(plan.warnings.some(warning => warning.includes('already loaded')));
    assert.ok(plan.warnings.some(warning => warning.includes('restart')));
    assert.equal((await f.actions.describe(f.state.get(ID))).workingStatus, 'disabled');
    await perform(f, 'enable');
    assert.equal(await readFile(f.path, 'utf8'), text);
    assert.equal((await f.actions.describe(f.state.get(ID))).workingStatus, 'enabled');
  }
});

test('resource limits or linked resources restrict file actions but retain safe instruction policy control', async t => {
  for (const kind of ['linked', 'oversized']) {
    const f = await fixture(t, kind === 'oversized' ? { settings: { actionMaxFiles: 1 } } : {});
    const resource = join(f.directory, 'resource.txt'); await writeFile(resource, 'resource');
    if (kind === 'linked') await link(resource, join(f.root, 'external-link'));
    const management = await f.actions.describe(f.state.get(ID));
    assert.equal(management.eligible, true);
    assert.equal(management.reasonCode, 'file-actions-unavailable');
    assert.deepEqual(management.allowedActions, ['disable']);
    await perform(f, 'disable');
    assert.equal(await readFile(resource, 'utf8'), 'resource');
    await perform(f, 'enable');
    assert.equal(await readFile(f.path, 'utf8'), TEXT);
  }
});

test('late quarantine changes are never purged after a durable authorized phase', async t => {
  const f = await fixture(t, { flat: true }), plan = await f.actions.prepare({ id: ID, action: 'delete' });
  f.state.onSave = (_id, control, kind, details) => {
    if (kind === 'action-phase' && details.phase === 'purge-authorized') {
      assert.ok(control.pending.destination.startsWith(f.root + sep));
      writeFileSync(control.pending.destination, TEXT + 'late writer bytes');
    }
  };
  await assert.rejects(f.actions.execute({ token: plan.token, confirmationText: plan.name }), code('recovery-required', 409));
  assert.equal(await readFile(f.controls.get(ID).pending.destination, 'utf8'), TEXT + 'late writer bytes');
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'recovery-required');
});

test('restore destination created after authorization is preserved, with archive recoverable', async t => {
  const f = await fixture(t); await perform(f, 'archive');
  const plan = await f.actions.prepare({ id: ID, action: 'restore' });
  f.state.onSave = (_id, control, kind, details) => {
    if (kind === 'action-phase' && details.phase === 'restore-authorized') {
      assert.ok(control.pending.originalPath.startsWith(f.root + sep));
      writeFileSync(control.pending.originalPath, 'new owner data');
    }
  };
  await assert.rejects(f.actions.execute({ token: plan.token }), code('recovery-required', 409));
  assert.equal(await readFile(f.directory, 'utf8'), 'new owner data');
  assert.equal(await readFile(join(f.controls.get(ID).archive.path, 'SKILL.md'), 'utf8'), TEXT);
});

test('symlink replacement after intent is rejected without following or purging it', async t => {
  const f = await fixture(t, { flat: true }), saved = join(f.root, 'preserved.md');
  const plan = await f.actions.prepare({ id: ID, action: 'delete' });
  f.state.onSave = (_id, _control, kind) => {
    if (kind === 'action-intent') {
      assert.ok(f.path.startsWith(f.root + sep) && saved.startsWith(f.root + sep));
      renameSync(f.path, saved); symlinkSync(saved, f.path);
    }
  };
  await assert.rejects(f.actions.execute({ token: plan.token, confirmationText: plan.name }), code('recovery-required', 409));
  assert.equal(await readFile(saved, 'utf8'), TEXT);
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'recovery-required');
});

test('admitted operation reports running, survives unload quiescently and expires every other plan', async t => {
  const f = await fixture(t), plan = await f.actions.prepare({ id: ID, action: 'disable' });
  let disposed, liveStatus, liveManagement;
  f.state.onSave = (_id, _control, kind) => {
    if (kind === 'action-intent') {
      liveStatus = f.actions.operationStatus({ id: ID, operationId: plan.operationId });
      liveManagement = f.actions.describe(f.state.get(ID));
      disposed = f.actions.dispose();
    }
  };
  const result = await f.actions.execute({ token: plan.token });
  await disposed;
  assert.equal(liveStatus.status, 'running');
  assert.equal((await liveManagement).reasonCode, 'operation-running');
  assert.equal(result.management.workingStatus, 'disabled');
  await assert.rejects(f.actions.prepare({ id: ID, action: 'enable' }), code('disposed', 410));
});

test('unsafe YAML policy aliases and invalid UTF-8 are rejected without rewriting unrelated metadata', async t => {
  const f = await fixture(t);
  const anchored = TEXT.replace('disable-model-invocation: false', 'disable-model-invocation: &shared false').replace('custom:', 'another: *shared\ncustom:');
  await writeFile(f.path, anchored);
  await assert.rejects(f.actions.prepare({ id: ID, action: 'disable' }), code('invalid', 400));
  assert.equal(await readFile(f.path, 'utf8'), anchored);
  const invalid = Buffer.concat([Buffer.from(TEXT), Buffer.from([0xff])]);
  await writeFile(f.path, invalid);
  await assert.rejects(f.actions.prepare({ id: ID, action: 'disable' }), code('invalid', 400));
  assert.deepEqual(await readFile(f.path), invalid);
  assert.equal(f.events.length, 0);
});

test('plan capacity is bounded independently from observation cache and expired plans release capacity', async t => {
  const f = await fixture(t, { settings: { actionMaxPlans: 1, observationCacheSize: 100 } });
  await f.actions.prepare({ id: ID, action: 'disable' });
  await assert.rejects(f.actions.prepare({ id: ID, action: 'archive' }), code('limit', 400));
  f.advance(120001);
  assert.equal((await f.actions.prepare({ id: ID, action: 'archive' })).action, 'archive');
  assert.equal(f.events.length, 0);
});

test('configured protected directory aliases also protect their canonical physical target', async t => {
  const f = await fixture(t), alias = join(f.root, 'protected-alias'); await symlink(f.directory, alias);
  const actions = f.make({ protectedRoots: [alias] });
  assert.equal((await actions.describe(f.state.get(ID))).reasonCode, 'protected');
});

test('cross-host journal CAS refusal preserves the other operation and performs no filesystem changes', async t => {
  const f = await fixture(t), plan = await f.actions.prepare({ id: ID, action: 'archive' });
  const other = { version: 1, pending: { operationId: 'other-host-operation', phase: 'intent' },
    lastOperation: { id: 'other-host-operation', action: 'archive', status: 'running', at: '2026-11-08T00:00:00.000Z' } };
  f.state.onSave = (_id, _control, kind, _details, expected) => {
    if (kind === 'action-intent') { assert.deepEqual(expected, {}); f.controls.set(ID, structuredClone(other)); }
  };
  await assert.rejects(f.actions.execute({ token: plan.token }), code('conflict', 409));
  assert.deepEqual(f.controls.get(ID), other);
  assert.equal(await readFile(f.path, 'utf8'), TEXT);
  assert.deepEqual(await readdir(f.parent), ['example']);
  assert.equal(f.actions.operationStatus({ id: ID, operationId: plan.operationId }).status, 'failed');
  assert.equal(f.events.length, 0);
});

test('actions are per-instance even when names match', async t => {
  const f = await fixture(t, { flat: true }), otherPath = join(f.parent, 'other.md');
  await writeFile(otherPath, TEXT);
  f.records.set(OTHER, { ...f.state.get(ID), id: OTHER, path: otherPath });
  await perform(f, 'disable');
  assert.match(await readFile(f.path, 'utf8'), /disable-model-invocation: true/);
  assert.equal(await readFile(otherPath, 'utf8'), TEXT);
  assert.equal(f.controls.has(OTHER), false);
});
