import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply } from '../src/index.js';

async function host(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-host-'));
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + '/') && absolute.includes('dsh-skill-manager-host-'));
  const services = new Map(), routes = new Map(), tools = new Map(), effects = [], listeners = new Map();
  services.set('skills', { snapshot: async () => ({ skills: [{ name: 'virtual-skill', provider: 'fixture', description: 'Virtual skill', source: 'runtime' }], complete: true }) });
  const ctx = {
    get: key => services.get(key),
    provide: (key, value) => { services.set(key, value); const dispose = () => services.delete(key); effects.push(dispose); return dispose; },
    emit: (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args); },
    on: (event, listener) => { const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(listener); const dispose = () => set.delete(listener); effects.push(dispose); return dispose; },
    effect: register => { const dispose = register(); effects.push(dispose); return dispose; },
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  };
  const activation = apply(ctx, { databasePath: join(directory, 'skills.sqlite'), scanIntervalMs: 86400000 });
  assert.equal(activation, undefined, 'Activation must not await catalog discovery');
  t.after(async () => { for (const dispose of effects.reverse()) await dispose?.(); await rm(absolute, { recursive: true, force: true }); });
  await services.get('skillManager').refresh();
  return { ctx, services, routes, tools, effects };
}

test('owner-channel exact routes and tool share application operations and validation', async t => {
  const h = await host(t), tool = h.tools.get('skill_manager');
  assert.deepEqual([...h.routes.keys()].sort(), ['/api/skill-manager/v1/refresh', '/api/skill-manager/v1/skills', '/api/skill-manager/v1/snapshot']);
  const route = name => h.routes.get('/api/skill-manager/v1/' + name);
  const response = await route('snapshot').fetch(new Request('http://fixture/api/skill-manager/v1/snapshot'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const snapshot = await response.json();
  const list = await tool.execute({ action: 'list', search: 'VIRTUAL', limit: 1 });
  assert.equal(list.total, 1);
  assert.deepEqual(list.skills[0], snapshot.skills[0]);
  const id = list.skills[0].id;
  assert.equal((await tool.execute({ action: 'detail', id })).skill.id, id);
  assert.equal((await tool.execute({ action: 'refresh' })).apiVersion, 1);
  for (const args of [{ action: 'list', limit: 0 }, { action: 'detail', id, limit: 0 }, { action: 'list', search: 5 }, { action: 'detail', id, search: 'x' }, { action: 'refresh', limit: 1 }, { action: 'list', typo: true }]) assert.equal((await tool.execute(args)).error.code, 'invalid-request');
  const invalid = await route('skills').fetch(new Request(`http://fixture/api/skill-manager/v1/skills?id=${id}&limit=0`));
  assert.equal(invalid.status, 400);
  assert.equal((await route('skills').fetch(new Request('http://fixture/api/skill-manager/v1/skills?id=' + 'a'.repeat(64)))).status, 404);
  assert.equal((await route('refresh').fetch(new Request('http://fixture/api/skill-manager/v1/refresh', { method: 'POST' }))).status, 200);
});

test('host apply returns before preset enumeration can await its own activation', async t => {
  const h = await host(t);
  assert.equal(h.services.get('skillManager').apiVersion, 1);
  assert.equal(typeof h.services.get('skillManager').dispose, 'undefined');
  const before = h.services.get('skillManager').snapshot();
  before.contexts.push({ id: 'tamper', label: 'Tampered', cwd: null });
  assert.ok(!h.services.get('skillManager').snapshot().contexts.some(value => value.id === 'tamper'));
  for (const dispose of h.effects.splice(0).reverse()) await dispose?.();
  assert.equal(h.services.has('skillManager'), false);
  assert.equal(h.routes.size, 0);
  assert.equal(h.tools.size, 0);
});
