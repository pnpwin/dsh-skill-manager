import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = resolve(await mkdtemp(join(tmpdir(), 'dsh-skill-layout-')));
  assert.ok(root.startsWith(resolve(tmpdir()) + sep) && root.includes('dsh-skill-layout-'));
  t.after(async () => { assert.ok(root.startsWith(resolve(tmpdir()) + sep) && root.includes('dsh-skill-layout-')); await rm(root, { recursive: true, force: true }); });
  for (const name of ['src', 'locale', 'tests', 'test', 'locate']) await mkdir(join(root, name));
  const manifest = { name: '@fixture/plugin', type: 'module', exports: { '.': './src/index.js', './icon': './icon.svg' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'src', 'index.js'), 'export function apply() {}\n');
  await writeFile(join(root, 'src', 'check.js'), await readFile(new URL('../src/check.js', import.meta.url), 'utf8'));
  for (const name of ['README.md', 'LICENSE', 'UPSTREAM.md', 'AGENTS.md', 'cordis.patch.yml', '.gitignore']) await writeFile(join(root, name), 'fixture\n');
  await writeFile(join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n');
  for (const lang of ['en', 'ru']) await writeFile(join(root, 'locale', `${lang}.json`), JSON.stringify({ meta: { title: 'Fixture', description: 'Fixture' } }));
  return root;
}
const check = root => spawnSync(process.execPath, [join(root, 'src', 'check.js')], { encoding: 'utf8' });

test('native ESM GitHub distribution has no automatic lifecycle build hooks', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const hook of ['prepare', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'preinstall', 'install', 'postinstall']) assert.equal(Object.hasOwn(manifest.scripts, hook), false, `Unexpected lifecycle hook: ${hook}`);
  assert.equal(manifest.scripts.build, 'node src/check.js');
  assert.equal(manifest.scripts['release:check'], 'npm test && npm run build');
});

test('package gate allows documentation metadata and existing test/resource directories', async t => {
  const root = await fixture(t), result = check(root);
  assert.equal(result.status, 0, result.stderr);
});

for (const name of ['index.js', 'client.tsx', 'build.sh', 'helper.py']) {
  test(`package gate rejects executable root file ${name}`, async t => {
    const root = await fixture(t);
    await writeFile(join(root, name), 'fixture\n');
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Root executable is forbidden/);
  });
}

test('package gate rejects root scratch logs instead of allowing arbitrary non-code files', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'debug.log'), 'fixture\n');
  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected package-root file/);
});
