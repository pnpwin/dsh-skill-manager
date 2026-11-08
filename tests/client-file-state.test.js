import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
const start = source.indexOf('    function fileStateLabel('), end = source.indexOf('    function validManagementPlan(', start);
assert.ok(start >= 0 && end > start);
const label = runInNewContext(`${source.slice(start, end)}\nfileStateLabel`, Object.create(null), { timeout: 1000 });
const skill = () => ({ provider: 'example-provider', source: 'runtime', status: 'present', path: null,
  management: { mode: 'override', workingStatus: 'enabled', fileStatus: 'unknown', reasonCode: 'file-actions-protected', eligible: true, allowedActions: ['disable'] } });

test('a known provider without an instruction path is explicit rather than an unknown file state', () => {
  assert.equal(label(skill()), 'fileInstructionNotProvided');
});

test('a resource directory or URL does not prove an instruction file exists', () => {
  for (const resourceBase of [{ kind: 'directory', path: '/example/resources' }, { kind: 'url', url: 'https://example.test/resources/node_modules' }, { kind: 'opaque', description: 'Provider-owned' }]) {
    const record = { ...skill(), resourceBase };
    assert.equal(label(record), 'fileInstructionNotProvided');
    assert.deepEqual(record.management.allowedActions, ['disable']);
  }
});

test('bundled/plugin policy-managed entries explain package protection without claiming an instruction path', () => {
  for (const origin of ['bundled', 'plugin']) assert.equal(label({ ...skill(), source: origin }), 'filePackageProtected');
});

test('package resource paths explain protected files for runtime definitions on POSIX and Windows', () => {
  for (const directory of ['/example/node_modules/example/skills', '/example/Application.asar/dsh/skills', '/example/app.asar.unpacked/skills', 'C:\\example\\node_modules\\example\\skills', 'C:\\example\\Application.asar\\skills']) {
    assert.equal(label({ ...skill(), resourceBase: { kind: 'directory', path: directory } }), 'filePackageProtected', directory);
  }
});

test('missing archived and deleted facts take precedence over provider/package labels', () => {
  for (const [fileStatus, expected] of [['missing', 'fileMissing'], ['archived', 'fileArchived'], ['deleted', 'fileDeleted']]) {
    const record = { ...skill(), source: 'bundled' }; record.management.fileStatus = fileStatus;
    assert.equal(label(record), expected);
  }
  assert.equal(label({ ...skill(), source: 'bundled', status: 'missing' }), 'fileMissing');
});

test('an unverified known file remains unknown, while verified local files retain their active label', () => {
  const record = { ...skill(), source: 'custom', provider: 'filesystem', path: '/example/skills/local/SKILL.md' };
  record.management = { ...record.management, mode: 'file', fileStatus: 'active', reasonCode: null, allowedActions: ['disable', 'archive', 'delete'] };
  assert.equal(label(record), 'fileActive');
  assert.equal(label({ ...record, status: 'unknown' }), 'fileUnknown');
  assert.equal(label({ ...record, management: { ...record.management, reasonCode: 'availability-unknown' } }), 'fileUnknown');
});

test('synthetic unknown definitions do not pretend to have a known provider or package file policy', () => {
  assert.equal(label({ ...skill(), source: 'unknown', provider: 'unknown' }), 'fileUnknown');
  assert.equal(label({ ...skill(), provider: 'unknown' }), 'fileUnknown');
  assert.equal(label(undefined), 'fileUnknown');
});

test('file label derivation is read-only and never grants archive delete or restore', () => {
  const record = skill(), before = JSON.stringify(record);
  for (const directory of ['/example/resources', '/example/node_modules/example/resources']) {
    const value = { ...record, resourceBase: { kind: 'directory', path: directory } };
    label(value);
    assert.deepEqual(value.management.allowedActions, ['disable']);
  }
  assert.equal(JSON.stringify(record), before);
});

test('the file action panel uses the derived bilingual labels', () => {
  assert.match(source, /t\(fileStateLabel\(skill, management\)\)/);
  for (const text of ['Instruction file not specified by the provider', 'Package files are protected', 'Файл инструкции не указан провайдером', 'Файлы пакета защищены']) assert.ok(source.includes(text));
});
