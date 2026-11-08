import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute only the self-contained pure projection, not React/DOM or a mock screenshot.
const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const start = source.indexOf('function selectGroups('), end = source.indexOf('const css =', start);
assert.ok(start >= 0 && end > start);
const selectGroups = vm.runInNewContext(`(${source.slice(start, end).trim()})`);
const filters = extra => ({ query: '', source: '', status: '', sort: 'name', locale: 'en', ...extra });
const skills = [
  { id: 'a', name: 'review', source: 'project-dsh', status: 'present', description: 'Local review', path: '/a.md', availability: [] },
  { id: 'b', name: 'review', source: 'user-dsh', status: 'missing', description: 'Shared review', path: '/b.md', availability: [] },
  { id: 'c', name: 'other', source: 'runtime', status: 'present', description: 'Virtual', resourceBase: { kind: 'opaque', description: 'Managed base' }, availability: [{ contextId: 'scope', source: 'custom', description: 'Scoped description', effective: true }] },
];
const groups = [
  { id: 'review', name: 'review', instanceIds: ['a', 'b'], instanceCount: 2, usage: { total: 12 } },
  { id: 'other', name: 'other', instanceIds: ['c'], instanceCount: 1, usage: { total: 3 } },
];

test('client filter retains the whole matching group and authoritative totals', () => {
  const rows = selectGroups(groups, skills, filters({ source: 'project-dsh' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].members.length, 2);
  assert.equal(rows[0].group.usage.total, 12);
  assert.equal(rows[0].matchingIds.join(','), 'a');
});

test('combined filters cannot match source on one instance and status on another', () => {
  assert.equal(selectGroups(groups, skills, filters({ source: 'project-dsh', status: 'missing' })).length, 0);
  assert.equal(selectGroups(groups, skills, filters({ source: 'user-dsh', status: 'missing' }))[0].members.length, 2);
});

test('client search includes scope metadata and resource base without reaggregating', () => {
  assert.equal(selectGroups(groups, skills, filters({ query: 'MANAGED BASE' }))[0].group.id, 'other');
  assert.equal(selectGroups(groups, skills, filters({ query: 'Scoped description', source: 'custom' }))[0].group.id, 'other');
});

test('client paging input sorts groups and projection never mutates API data', () => {
  const before = JSON.stringify({ groups, skills });
  const rows = selectGroups(groups, skills, filters({ sort: 'total' }));
  assert.equal(rows[0].group.id, 'review');
  assert.equal(JSON.stringify({ groups, skills }), before);
  assert.equal(rows.length, 2);
});

test('client requires authoritative groups and keeps disclosure and per-instance detail actions', () => {
  assert.match(source, /!Array\.isArray\(data\.groups\)/);
  assert.match(source, /'aria-expanded':expanded/);
  assert.match(source, /onSelect\(member\.id\)/);
  assert.match(source, /skills\?id=\$\{encodeURIComponent\(id\)\}/);
  assert.ok(!source.includes("require('@deepseek-ai/dsh-client"));
});
