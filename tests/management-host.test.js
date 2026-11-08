import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { apply } from '../src/index.js';

const PREFIX = '/api/skill-manager/v1/';
const BODY = '\n# Private fixture instructions\n\nKeep body bytes unchanged.\n';
const TEXT = `---\nname: managed-fixture\ndescription: Metadata only\ncustom: keep-me\nuser-invocable: true\n---\n${BODY}`;
const RESOURCE = Buffer.from([0, 1, 2, 127, 255]);
const absent = async path => assert.rejects(stat(path), { code: 'ENOENT' });
const policy = text => parse(/^---\n([\s\S]*?)\n---\n/.exec(text)[1]);

async function host(t, options = {}) {
  const tempRoot = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(tempRoot, 'dsh-management-host-')));
  const skillDirectory = join(directory, 'skills', 'managed-fixture');
  const path = join(skillDirectory, 'SKILL.md'), resource = join(skillDirectory, 'resources', 'data.bin');
  const filename = join(directory, 'skills.sqlite');
  const verifyOwned = async () => {
    assert.ok(isAbsolute(directory));
    assert.equal(resolve(directory), directory);
    assert.equal(join(tempRoot, basename(directory)), directory);
    assert.ok(basename(directory).startsWith('dsh-management-host-'));
    assert.ok(directory.startsWith(tempRoot + sep));
    assert.equal(await realpath(directory), directory);
    assert.equal(resolve(path), join(directory, 'skills', 'managed-fixture', 'SKILL.md'));
    assert.equal(resolve(skillDirectory), join(directory, 'skills', 'managed-fixture'));
  };
  await verifyOwned();
  await mkdir(join(skillDirectory, 'resources'), { recursive: true });
  await writeFile(path, TEXT);
  await writeFile(resource, RESOURCE);
  if (options.plugin) await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'owned-plugin-fixture', dsh: { bundle: { patch: './fixture.yml' } } }));
  let summaries = [{ name: 'managed-fixture', description: 'Metadata only', provider: 'filesystem', source: 'custom', path,
    resourceBase: { kind: 'directory', path: skillDirectory }, invocation: { modelInvocable: true, userInvocable: true }, ...options.summary }];
  const services = new Map(), routes = new Map(), tools = new Map(), effects = [], listeners = new Map();
  services.set('skills', { snapshot: async () => ({ skills: summaries, complete: true }) });
  const ctx = {
    get: key => services.get(key),
    provide: (key, value) => { services.set(key, value); const dispose = () => services.delete(key); effects.push(dispose); return dispose; },
    emit: (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args); },
    on: (event, listener) => { const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(listener); const dispose = () => set.delete(listener); effects.push(dispose); return dispose; },
    effect: register => { const dispose = register(); effects.push(dispose); return dispose; },
    connection: { fetch: { register: route => { assert.ok(!routes.has(route.path)); routes.set(route.path, route); return () => routes.delete(route.path); } } },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  };
  t.after(async () => {
    try { for (const dispose of effects.reverse()) await dispose?.(); }
    finally { await verifyOwned(); await rm(directory, { recursive: true, force: true }); }
  });
  assert.equal(apply(ctx, { databasePath: filename, scanIntervalMs: 86400000, debounceMs: 60000, ...options.config }), undefined);
  const api = services.get('skillManager');
  await api.refresh();
  const id = api.snapshot().skills[0].id;
  const call = async (name, value, overrides = {}) => {
    const route = routes.get(PREFIX + name);
    assert.ok(route, `Exact owner-channel route ${name} is registered`);
    const method = route.methods[0];
    const url = new URL('http://owned-fixture' + PREFIX + name);
    if (method === 'GET' && value) for (const [key, entry] of Object.entries(value)) url.searchParams.set(key, entry);
    const request = new Request(url, { method, ...(method === 'POST' && value !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {}), ...overrides });
    const response = await route.fetch(request);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    return { status: response.status, value: await response.json() };
  };
  const prepare = async action => {
    const result = await call('manage/prepare', { id, action });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return result.value;
  };
  const execute = async (plan, confirmationText) => {
    // The route may rename/delete a bundle: validate its exact owned canonical target immediately beforehand.
    await verifyOwned();
    assert.ok(plan.path.startsWith(directory + sep));
    assert.equal(await realpath(plan.path), resolve(plan.path));
    return call('manage/execute', { token: plan.token, ...(confirmationText === undefined ? {} : { confirmationText }) });
  };
  const status = plan => call('manage/status', { id, operationId: plan.operationId });
  const persisted = () => {
    const db = new DatabaseSync(filename, { readOnly: true });
    try { return JSON.stringify(Object.fromEntries(['skills', 'events', 'file_controls'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]))); }
    finally { db.close(); }
  };
  return { directory, skillDirectory, path, resource, filename, api, ctx, routes, tools, id, call, prepare, execute, status, persisted, verifyOwned,
    summaries: value => { summaries = value; } };
}

function succeeded(result) { assert.equal(result.status, 200, JSON.stringify(result.value)); }
async function unchanged(h, text = TEXT) {
  assert.equal(await readFile(h.path, 'utf8'), text);
  assert.deepEqual(await readFile(h.resource), RESOURCE);
}
function noSecrets(value, plan) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(plan.token), 'Confirmation token must stay off read surfaces and durable history');
  assert.ok(!text.includes(BODY.trim()), 'Instruction bodies must not be persisted or returned');
}

test('owner route registrations isolate management from the read-only Cordis API and agent tool', async t => {
  const h = await host(t), tool = h.tools.get('skill_manager');
  assert.deepEqual([...h.routes.keys()].sort(), ['manage/execute', 'manage/prepare', 'manage/status', 'refresh', 'skills', 'snapshot'].map(name => PREFIX + name).sort());
  for (const [name, method] of [['manage/prepare', 'POST'], ['manage/execute', 'POST'], ['manage/status', 'GET']]) {
    assert.deepEqual(h.routes.get(PREFIX + name).methods, [method]);
    assert.equal(h.routes.get(PREFIX + name).requestBody, 'buffered');
  }
  assert.deepEqual(Object.keys(h.api).sort(), ['apiVersion', 'detail', 'refresh', 'snapshot', 'subscribe']);
  assert.ok(Object.isFrozen(h.api));
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'detail', 'refresh']);
  const before = h.api.detail(h.id).total;
  for (const action of ['enable', 'disable', 'archive', 'restore', 'delete', 'prepareAction', 'executeAction']) {
    assert.equal((await tool.execute({ action, id: h.id })).error.code, 'invalid-request');
  }
  assert.equal(h.api.detail(h.id).total, before);
  assert.equal(h.api.snapshot().skills[0].management.workingStatus, 'enabled');
  await unchanged(h);
});

test('management routes require bounded JSON, exact keys, canonical IDs, actions and status fields', async t => {
  const h = await host(t);
  const invalid = [
    ['manage/prepare', { id: h.id, action: 'disable', path: h.path }],
    ['manage/prepare', { id: h.id, action: 'disable', destination: h.directory }],
    ['manage/prepare', { id: '../SKILL.md', action: 'disable' }],
    ['manage/prepare', { id: h.id.toUpperCase(), action: 'disable' }],
    ['manage/prepare', { id: h.id, action: 'install' }],
    ['manage/prepare', []], ['manage/prepare', null],
    ['manage/execute', { token: 'short' }],
    ['manage/execute', { token: 'x'.repeat(513) }],
    ['manage/execute', { token: 'x'.repeat(32), path: h.path }],
    ['manage/execute', { token: 'x'.repeat(32), confirmationText: 5 }],
    ['manage/status', { id: h.id, operationId: 'short' }],
    ['manage/status', { id: h.id, operationId: 'x'.repeat(32), path: h.path }],
    ['manage/status', { id: 'unknown', operationId: 'x'.repeat(32) }],
  ];
  for (const [name, value] of invalid) {
    const response = await h.call(name, value);
    assert.equal(response.status, 400, JSON.stringify({ name, value, response }));
    assert.equal(response.value.error.code, 'invalid-request');
  }
  for (const contentType of ['text/plain', 'application/jsonp', 'application/json-malformed']) assert.equal((await h.call('manage/prepare', { id: h.id, action: 'disable' }, { headers: { 'content-type': contentType } })).status, 400);
  succeeded(await h.call('manage/prepare', { id: h.id, action: 'disable' }, { headers: { 'content-type': 'Application/JSON; charset=utf-8' } }));
  assert.equal((await h.call('manage/prepare', undefined)).status, 400);
  assert.equal((await h.call('manage/prepare', {}, { body: '{' })).status, 400);
  for (const name of ['manage/prepare', 'manage/execute']) {
    const response = await h.call(name, {}, { body: JSON.stringify({ padding: 'é'.repeat(4096) }) });
    assert.equal(response.status, 413);
    assert.equal(response.value.error.code, 'request-too-large');
  }
  const validBody = JSON.stringify({ id: h.id, action: 'disable' });
  const boundary = await h.call('manage/prepare', {}, { body: validBody + ' '.repeat(8192 - Buffer.byteLength(validBody)) });
  succeeded(boundary);
  const overBoundary = await h.call('manage/prepare', {}, { body: validBody + ' '.repeat(8193 - Buffer.byteLength(validBody)) });
  assert.equal(overBoundary.status, 413);
  assert.equal((await h.call('manage/execute', { token: 'x'.repeat(32) })).status, 410);
  assert.equal((await h.call('manage/status', { id: h.id, operationId: 'unknown-operation-12345' })).value.status, 'unknown');
  assert.equal((await h.call('manage/status', { id: '0'.repeat(64), operationId: boundary.value.operationId })).value.status, 'unknown');
  await unchanged(h);
});

test('prepare is pure; disable and enable preserve body/resources, refresh working status and verified owner attribution', async t => {
  const h = await host(t), before = h.api.detail(h.id), entries = await readdir(h.skillDirectory);
  const plan = await h.prepare('disable');
  assert.notEqual(plan.operationId, plan.token);
  assert.equal(plan.id, h.id);
  assert.equal(plan.action, 'disable');
  assert.equal((await h.status(plan)).value.status, 'not-started');
  assert.equal(h.api.detail(h.id).total, before.total);
  assert.deepEqual(await readdir(h.skillDirectory), entries);
  await unchanged(h);
  for (const read of [h.api.snapshot(), h.api.detail(h.id), (await h.call('snapshot')).value, (await h.tools.get('skill_manager').execute({ action: 'detail', id: h.id })), h.persisted()]) noSecrets(read, plan);
  succeeded(await h.execute(plan));
  const disabled = await readFile(h.path, 'utf8');
  assert.equal(policy(disabled)['disable-model-invocation'], true);
  assert.equal(policy(disabled)['user-invocable'], false);
  assert.equal(policy(disabled).custom, 'keep-me');
  assert.equal(disabled.slice(disabled.indexOf('\n---\n') + 5), BODY);
  assert.deepEqual(await readFile(h.resource), RESOURCE);
  assert.equal((await h.status(plan)).value.status, 'succeeded');
  assert.equal((await h.call('manage/execute', { token: plan.token })).status, 410);
  await h.api.refresh();
  const detail = h.api.detail(h.id);
  assert.equal(detail.skill.management.workingStatus, 'disabled');
  assert.deepEqual(detail.skill.modifiedBy, { kind: 'user', label: 'Owner UI' });
  assert.equal(detail.skill.createdBy, null);
  assert.ok(detail.events.some(event => event.kind === 'action-completed' && event.actor?.kind === 'user'));
  assert.ok(detail.events.some(event => event.kind === 'mutation' && event.actor?.label === 'Owner UI'));
  noSecrets(detail, plan); noSecrets(h.persisted(), plan);
  const enable = await h.prepare('enable'); succeeded(await h.execute(enable));
  await h.api.refresh();
  const enabled = await readFile(h.path, 'utf8');
  assert.equal(policy(enabled)['disable-model-invocation'], undefined, 'Original absent flag is restored');
  assert.equal(policy(enabled)['user-invocable'], true);
  assert.equal(enabled.slice(enabled.indexOf('\n---\n') + 5), BODY);
  assert.equal(h.api.detail(h.id).skill.management.workingStatus, 'enabled');
});

test('archive and restore include the entire owned bundle and preserve canonical identity, usage and prior history', async t => {
  const h = await host(t);
  h.ctx.emit('tools/result', { name: 'skill', callId: 'owned-call', arguments: { name: 'managed-fixture' }, agent: { session: { id: 'fixture-session' } } },
    { isError: false, value: { provider: 'filesystem', path: h.path, resourceBase: { kind: 'directory', path: h.skillDirectory } } });
  const before = h.api.detail(h.id);
  assert.equal(before.skill.usage.total, 1);
  const archive = await h.prepare('archive');
  assert.equal(archive.targetKind, 'directory');
  assert.equal(archive.fileCount, 2);
  succeeded(await h.execute(archive));
  await absent(h.skillDirectory);
  h.summaries([]); // A real registry no longer discovers the archived directory.
  await h.api.refresh();
  const archived = h.api.detail(h.id);
  assert.equal(archived.skill.id, h.id);
  assert.equal(archived.skill.management.fileStatus, 'archived');
  assert.deepEqual(archived.skill.management.allowedActions, ['restore', 'delete']);
  assert.deepEqual(archived.skill.usage, before.skill.usage);
  const restore = await h.prepare('restore');
  assert.equal(await readFile(join(restore.path, 'SKILL.md'), 'utf8'), TEXT);
  assert.deepEqual(await readFile(join(restore.path, 'resources', 'data.bin')), RESOURCE);
  succeeded(await h.execute(restore));
  await unchanged(h);
  h.summaries([before.skill]); // Rediscovery must reuse the tombstoned canonical instance.
  await h.api.refresh();
  const restored = h.api.detail(h.id);
  assert.equal(restored.skill.id, h.id);
  assert.equal(restored.skill.management.fileStatus, 'active');
  assert.deepEqual(restored.skill.usage, before.skill.usage);
  for (const event of before.events) assert.ok(restored.events.some(value => value.id === event.id));
  assert.ok(restored.events.some(event => event.kind === 'action-completed' && event.details.action === 'archive'));
  assert.ok(restored.events.some(event => event.kind === 'action-completed' && event.details.action === 'restore'));
  assert.equal((await h.call('manage/execute', { token: restore.token })).status, 410);
  await unchanged(h);
});

test('delete requires exact confirmation and a failed confirmation consumes the service plan', async t => {
  const h = await host(t), plan = await h.prepare('delete');
  assert.equal(plan.confirmationText, 'managed-fixture');
  const wrong = await h.execute(plan, 'Managed-fixture');
  assert.equal(wrong.status, 400);
  await unchanged(h);
  assert.equal((await h.call('manage/execute', { token: plan.token, confirmationText: plan.confirmationText })).status, 410);
  const fresh = await h.prepare('delete');
  succeeded(await h.execute(fresh, fresh.confirmationText));
  await absent(h.skillDirectory);
  assert.equal((await h.status(fresh)).value.status, 'succeeded');
  assert.equal((await h.call('manage/execute', { token: fresh.token, confirmationText: fresh.confirmationText })).status, 410);
  await h.api.refresh();
  assert.equal(h.api.detail(h.id).skill.management.fileStatus, 'deleted');
  assert.equal(h.api.detail(h.id).skill.id, h.id);
});

test('restore never overwrites an occupied original destination', async t => {
  const h = await host(t), archive = await h.prepare('archive'); succeeded(await h.execute(archive));
  await mkdir(h.skillDirectory);
  await writeFile(h.path, 'new owner content');
  const restore = await h.prepare('restore');
  const response = await h.execute(restore);
  assert.equal(response.status, 409);
  assert.equal(response.value.error.code, 'conflict');
  assert.equal(await readFile(h.path, 'utf8'), 'new owner content');
  assert.equal(await readFile(join(restore.path, 'SKILL.md'), 'utf8'), TEXT);
  assert.deepEqual(await readFile(join(restore.path, 'resources', 'data.bin')), RESOURCE);
  assert.equal((await h.call('manage/execute', { token: restore.token })).status, 410);
});

test('changed filesystem revisions invalidate plans without mutation or replay', async t => {
  const h = await host(t), plan = await h.prepare('archive');
  await writeFile(h.resource, 'changed after prepare');
  const response = await h.execute(plan);
  assert.equal(response.status, 409);
  assert.equal(response.value.error.code, 'conflict');
  assert.equal(await readFile(h.path, 'utf8'), TEXT);
  assert.equal(await readFile(h.resource, 'utf8'), 'changed after prepare');
  assert.equal((await h.call('manage/execute', { token: plan.token })).status, 410);
  assert.ok(['not-started', 'failed'].includes((await h.status(plan)).value.status));
  assert.ok(!h.persisted().includes('action-intent'));
});

test('expired confirmation tokens cannot mutate a real owned filesystem target', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = await host(t, { config: { actionTokenTtlMs: 1000 } }), plan = await h.prepare('archive');
  t.mock.timers.tick(1001);
  const response = await h.execute(plan);
  assert.equal(response.status, 410);
  assert.equal(response.value.error.code, 'expired');
  await unchanged(h);
  assert.equal((await h.call('manage/execute', { token: plan.token })).status, 410);
});

for (const [label, options] of [
  ['packaged definition', { summary: { provider: 'bundled-fixture', source: 'bundled' } }],
  ['custom filesystem definition owned by a plugin manifest', { plugin: true }],
]) test(`${label} rejects archive/delete without touching package files`, async t => {
  const h = await host(t, options);
  for (const action of ['archive', 'delete']) {
    const response = await h.call('manage/prepare', { id: h.id, action });
    assert.equal(response.status, 403);
    assert.equal(response.value.error.code, 'protected');
  }
  await unchanged(h);
  assert.ok(!h.persisted().includes('action-intent'));
});
