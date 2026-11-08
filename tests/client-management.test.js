import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise actual pure client guards only. No React/DOM emulation or visual claims.
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
const start = source.indexOf('    function allowedManagementActions(');
const end = source.indexOf('    // Pure view projection:');
assert.ok(start >= 0 && end > start, 'client guard boundaries remain discoverable');
const guards = runInNewContext(`${source.slice(start, end)}\n({allowedManagementActions, managementPresentation, validManagementPlan, canConfirmManagementPlan, managementOutcomeUncertain, managementStatusResolved})`, Object.create(null), { timeout: 1000 });
const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const local = { id: 'test-file-instance', name: 'точное-имя', provider: 'filesystem', source: 'custom', status: 'present', management: { mode: 'file', eligible: true, allowedActions: ['enable', 'disable', 'archive', 'restore', 'delete'] } };
const packaged = { id: 'test-policy-instance', name: 'package-skill', provider: 'test-provider', source: 'bundled', management: { mode: 'override', eligible: true, allowedActions: ['enable', 'disable'] } };
const base = skill => ({ token: 'opaque-test-token', operationId: 'test-operation', id: skill.id, name: skill.name, action: 'disable', expiresAt: new Date(NOW + 120000).toISOString(), warnings: [], confirmationText: null });
const filePlan = (action = 'disable') => ({ ...base(local), action, path: '/example/skills/example/SKILL.md', targetKind: 'file', fileCount: 1, totalBytes: 123, confirmationText: action === 'delete' ? local.name : null });
const policyPlan = (action = 'disable') => ({ ...base(packaged), action, mode: 'override', path: null, targetKind: 'policy', fileCount: 0, totalBytes: 0 });

test('capabilities come from explicit backend eligibility and allowed actions, not source labels', () => {
  assert.deepEqual(Array.from(guards.allowedManagementActions(undefined)), []);
  assert.deepEqual(Array.from(guards.allowedManagementActions({ eligible: false, allowedActions: ['delete'], source: 'custom' })), []);
  assert.deepEqual(Array.from(guards.allowedManagementActions({ eligible: true, allowedActions: ['enable', 'disable', 'unknown'], source: 'bundled', mode: 'override' })), ['enable', 'disable']);
  assert.deepEqual(Array.from(guards.allowedManagementActions(packaged.management)), ['enable', 'disable']);
});

test('file branch preserves positive file counts, physical target scope and exact delete name', () => {
  for (const action of ['enable', 'disable', 'archive', 'restore', 'delete']) {
    assert.equal(guards.validManagementPlan(filePlan(action), local, action), true);
    assert.equal(guards.validManagementPlan({ ...filePlan(action), targetKind: 'directory', fileCount: 2 }, local, action), true);
  }
  assert.equal(guards.validManagementPlan({ ...filePlan(), totalBytes: 0 }, local, 'disable'), true, 'an empty instruction file is still one file');
  for (const patch of [{ path: null }, { path: undefined }, { path: '' }, { targetKind: 'policy' }, { targetKind: 'root' }, { fileCount: 0 }, { fileCount: 1.5 }, { totalBytes: -1 }, { totalBytes: Number.NaN }]) {
    assert.equal(guards.validManagementPlan({ ...filePlan(), ...patch }, local, 'disable'), false, JSON.stringify(patch));
  }
  for (const confirmationText of [null, '', 'different-name']) {
    assert.equal(guards.validManagementPlan({ ...filePlan('delete'), confirmationText }, local, 'delete'), false);
  }
});

test('no-file policy plans require exact selected override mode and server-authorized enable/disable', () => {
  for (const action of ['enable', 'disable']) {
    assert.equal(guards.validManagementPlan(policyPlan(action), packaged, action), true);
    assert.equal(guards.canConfirmManagementPlan(policyPlan(action), '', NOW), true, 'explicit Confirm button is still required by the click flow');
  }
  const missingMode = { ...packaged, management: { ...packaged.management, mode: undefined } };
  const fileMode = { ...packaged, management: { ...packaged.management, mode: 'file' } };
  const forbidden = { ...packaged, management: { ...packaged.management, eligible: false } };
  const unadvertised = { ...packaged, management: { ...packaged.management, allowedActions: ['enable'] } };
  for (const skill of [missingMode, fileMode, forbidden, unadvertised, { ...packaged, management: undefined }]) {
    assert.equal(guards.validManagementPlan(policyPlan(), skill, 'disable'), false);
  }
});

test('policy scope cannot smuggle files, paths, byte counts or destructive actions', () => {
  for (const patch of [{ mode: undefined }, { mode: 'file' }, { targetKind: 'file' }, { targetKind: 'directory' }, { path: '' }, { path: '/example/target' }, { path: undefined }, { fileCount: 1 }, { fileCount: '0' }, { totalBytes: 1 }, { totalBytes: '0' }, { confirmationText: '' }, { confirmationText: undefined }]) {
    assert.equal(guards.validManagementPlan({ ...policyPlan(), ...patch }, packaged, 'disable'), false, JSON.stringify(patch));
  }
  const maliciousCapabilities = { ...packaged, management: { ...packaged.management, allowedActions: ['archive', 'restore', 'delete'] } };
  for (const action of ['archive', 'restore', 'delete']) {
    assert.equal(guards.validManagementPlan({ ...policyPlan(action), confirmationText: action === 'delete' ? packaged.name : null }, maliciousCapabilities, action), false);
  }
  assert.equal(guards.validManagementPlan({ ...filePlan(), id: packaged.id, name: packaged.name }, packaged, 'disable'), false, 'override-selected instance cannot silently accept a physical file plan');
});

test('both branches retain common identity, expiry format, opaque operation and warning validation', () => {
  for (const [plan, skill] of [[filePlan(), local], [policyPlan(), packaged]]) {
    for (const patch of [{ id: 'another' }, { name: 'another' }, { name: '' }, { action: 'enable' }, { token: '' }, { operationId: '' }, { expiresAt: 'not-a-date' }, { warnings: [{}] }, { confirmationText: {} }]) {
      assert.equal(guards.validManagementPlan({ ...plan, ...patch }, skill, 'disable'), false, JSON.stringify(patch));
    }
  }
});

test('delete confirmation is exact and every plan expires at its inclusive boundary', () => {
  const plan = filePlan('delete');
  assert.equal(guards.canConfirmManagementPlan(plan, local.name, NOW), true);
  for (const value of ['', ` ${local.name}`, `${local.name} `, local.name.toUpperCase()]) {
    assert.equal(guards.canConfirmManagementPlan(plan, value, NOW), false);
  }
  assert.equal(guards.canConfirmManagementPlan(plan, local.name, NOW + 120000), false);
  assert.equal(guards.canConfirmManagementPlan({ ...plan, confirmationText: null }, '', NOW), false);
  assert.equal(guards.canConfirmManagementPlan(policyPlan(), '', NOW + 120000), false);
});

test('network/recovery failures stay uncertain; not-started unlock requires status request after expiry', () => {
  for (const status of [400, 403, 404, 409, 410]) assert.equal(guards.managementOutcomeUncertain({ status }), false);
  for (const failure of [{}, { status: 500 }, { status: 503 }, { status: 200 }, { status: 409, code: 'recovery-required' }]) assert.equal(guards.managementOutcomeUncertain(failure), true);
  const expiry = policyPlan().expiresAt;
  for (const status of ['succeeded', 'failed']) assert.equal(guards.managementStatusResolved(status, expiry, NOW), true);
  assert.equal(guards.managementStatusResolved('not-started', expiry, NOW), false);
  assert.equal(guards.managementStatusResolved('not-started', expiry, NOW + 120000), true);
  for (const status of ['running', 'unknown', 'recovery-required', 'unrecognized']) assert.equal(guards.managementStatusResolved(status, expiry, NOW + 999999), false);
});

test('additive policy copy is bilingual and warns enabling is not a supplier force-grant', () => {
  const dictStart = source.indexOf('    const dictionaries =');
  const dictEnd = source.indexOf('    // Pure management guards:');
  assert.ok(dictStart >= 0 && dictEnd > dictStart);
  const dictionaries = runInNewContext(`${source.slice(dictStart, dictEnd)}\ndictionaries`, Object.create(null), { timeout: 1000 });
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.ru).sort());
  for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) assert.ok(Object.hasOwn(dictionaries.en, match[1]), match[1]);
  for (const lang of ['en', 'ru']) {
    assert.ok(dictionaries[lang].targetPolicy && dictionaries[lang].policyOverrideNote && dictionaries[lang].policyEnableNote);
    const metadata = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'));
    assert.ok(metadata.meta.title && metadata.meta.description);
  }
  assert.match(dictionaries.en.policyEnableNote, /only.*manager/);
  assert.match(dictionaries.ru.policyEnableNote, /ограничения поставщика/);
});

test('missing and unavailable selected records override stale enabled/disabled policy displays and plans', () => {
  for (const status of ['missing', 'unavailable']) {
    for (const workingStatus of ['enabled', 'disabled']) {
      const skill = { ...packaged, status, management: { ...packaged.management, workingStatus, fileStatus: 'active', configuredWorkingStatus: workingStatus } };
      const view = guards.managementPresentation(skill);
      assert.equal(view.workingStatus, 'unavailable');
      assert.equal(view.configuredWorkingStatus, workingStatus, 'saved policy is retained as separately labeled metadata');
      assert.deepEqual(Array.from(guards.allowedManagementActions(skill.management, skill)), []);
      for (const action of ['enable', 'disable']) assert.equal(guards.validManagementPlan(policyPlan(action), skill, action), false);
    }
    const physical = { ...local, status, management: { ...local.management, workingStatus: 'enabled', fileStatus: 'active' } };
    assert.deepEqual(Array.from(guards.allowedManagementActions(physical.management, physical)), []);
    for (const action of ['enable', 'disable', 'archive', 'restore', 'delete']) assert.equal(guards.validManagementPlan(filePlan(action), physical, action), false);
  }
});

test('backend unavailable working status and missing-file evidence fail closed without a parent status', () => {
  for (const evidence of [{ workingStatus: 'unavailable' }, { fileStatus: 'missing' }, { reasonCode: 'file-missing' }, { reasonCode: 'instance-unavailable' }, { reasonCode: 'availability-unknown' }]) {
    const management = { ...packaged.management, workingStatus: 'enabled', ...evidence };
    const skill = { ...packaged, management };
    assert.deepEqual(Array.from(guards.allowedManagementActions(management)), []);
    assert.equal(guards.validManagementPlan(policyPlan(), skill, 'disable'), false);
    assert.ok(['unavailable', 'unknown'].includes(guards.managementPresentation(skill).workingStatus));
  }
});

test('archived source remains unavailable while valid archive restore and deletion stay usable', () => {
  const archived = { ...local, status: 'missing', management: { ...local.management, fileStatus: 'archived', workingStatus: 'unavailable', configuredWorkingStatus: 'disabled' } };
  assert.equal(guards.managementPresentation(archived).workingStatus, 'unavailable');
  assert.deepEqual(Array.from(guards.allowedManagementActions(archived.management, archived)), ['restore', 'delete']);
  assert.deepEqual(Array.from(guards.allowedManagementActions(archived.management)), ['restore', 'delete']);
  for (const action of ['restore', 'delete']) assert.equal(guards.validManagementPlan(filePlan(action), archived, action), true);
  for (const action of ['enable', 'disable', 'archive']) assert.equal(guards.validManagementPlan(filePlan(action), archived, action), false);
  const deleted = { ...archived, management: { ...archived.management, fileStatus: 'deleted' } };
  assert.deepEqual(Array.from(guards.allowedManagementActions(deleted.management, deleted)), []);
  assert.equal(guards.validManagementPlan(filePlan('restore'), deleted, 'restore'), false);
});

test('present virtual definitions do not need a filesystem path; legacy undefined status still works', () => {
  const virtual = { ...packaged, status: 'present', path: null, management: { ...packaged.management, workingStatus: 'enabled', fileStatus: 'unknown' } };
  assert.equal(guards.managementPresentation(virtual).workingStatus, 'enabled');
  assert.deepEqual(Array.from(guards.allowedManagementActions(virtual.management, virtual)), ['enable', 'disable']);
  assert.equal(guards.validManagementPlan(policyPlan(), virtual, 'disable'), true);
  assert.equal(guards.validManagementPlan(policyPlan(), packaged, 'disable'), true, 'optional legacy status is not treated as confirmed absence');
});

test('saved policy is explicit metadata only when effective availability is unavailable or unknown', () => {
  const management = { ...packaged.management, workingStatus: 'enabled', configuredWorkingStatus: 'disabled' };
  assert.equal(guards.managementPresentation({ ...packaged, status: 'present', management }).configuredWorkingStatus, null);
  assert.equal(guards.managementPresentation({ ...packaged, status: 'missing', management }).configuredWorkingStatus, 'disabled');
  assert.equal(guards.managementPresentation({ ...packaged, status: 'unknown', management }).configuredWorkingStatus, 'disabled');
  assert.equal(guards.managementPresentation({ ...packaged, status: 'missing', management: { ...management, configuredWorkingStatus: undefined } }).configuredWorkingStatus, null);
  const dictStart = source.indexOf('    const dictionaries =');
  const dictEnd = source.indexOf('    // Pure management guards:');
  const dict = runInNewContext(`${source.slice(dictStart, dictEnd)}\ndictionaries`, Object.create(null), { timeout: 1000 });
  assert.equal(dict.en.workingUnavailable, 'Unavailable');
  assert.equal(dict.ru.workingUnavailable, 'Недоступен');
  assert.equal(dict.en.savedPolicy, 'Saved policy');
  assert.equal(dict.ru.savedPolicy, 'Сохранённая политика');
  assert.ok(source.includes("className:'dsm-caption'}, `${t('savedPolicy')}:"));
  assert.ok(!source.includes("t(workingKeys[management?.workingStatus]"));
});

test('mutation flow remains single, explicit and secret-token-only; policy target is not a path', () => {
  assert.equal((source.match(/request\('manage\/execute'/g) ?? []).length, 1);
  assert.ok(source.includes('const body = {token:confirmedPlan.token}'));
  assert.ok(source.includes('onClick:execute'));
  assert.ok(source.includes('validManagementPlan(plan, skill, plan.action)'));
  assert.ok(source.includes("plan.targetKind === 'policy' ? `${plan.name} · ${text(skill.provider, t('unknown'))}` : plan.path"));
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.body/.test(source));
});
