import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const targets = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(targets);
for (const target of targets(manifest.exports)) {
  if (target.includes('*')) continue;
  if (!target.startsWith('./') || !resolve(root, target).startsWith(root)) throw new Error(`Unsafe export ${target}`);
  if (!(await stat(resolve(root, target))).isFile()) throw new Error(`Missing export ${target}`);
}
for (const file of await readdir(join(root, 'src'))) {
  if (!file.endsWith('.js')) continue;
  const check = spawnSync(process.execPath, ['--check', join(root, 'src', file)], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr || `Syntax check failed: ${file}`);
}
for (const lang of ['en', 'ru']) {
  const locale = JSON.parse(await readFile(join(root, 'locale', `${lang}.json`), 'utf8'));
  if (!locale.meta?.title || !locale.meta?.description) throw new Error(`Missing ${lang} display metadata`);
}
const rootMetadata = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', '.gitignore', '.gitattributes', '.git', 'cordis.patch.yml', 'icon.svg']);
const rootDocument = /^(?:README|LICENSE|UPSTREAM|CHANGELOG|CONTRIBUTING|AGENTS|CODE_OF_CONDUCT|SECURITY)(?:\.[A-Za-z0-9_-]+)*$/;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isDirectory()) continue; // Existing tests/resource directories keep their locations.
  if (/\.(?:[cm]?js|jsx|tsx?|py|sh|bash|ps1|bat|cmd)$/.test(entry.name)) throw new Error(`Root executable is forbidden: ${entry.name}`);
  if (!rootMetadata.has(entry.name) && !rootDocument.test(entry.name)) throw new Error(`Unexpected package-root file: ${entry.name}; move implementation/resources into their owned directory`);
}
for (const file of ['cordis.patch.yml', 'LICENSE', 'README.md', 'icon.svg']) await stat(join(root, file));
const icon = await readFile(join(root, 'icon.svg'), 'utf8');
if (!icon.startsWith('<svg ') || !icon.includes('xmlns="http://www.w3.org/2000/svg"') || Buffer.byteLength(icon) > 262144) throw new Error('Invalid SVG icon');
async function markdownFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file);
  }
  return files;
}
const rootDocuments = (await readdir(root)).filter(file => rootDocument.test(file) && file.endsWith('.md')).map(file => join(root, file));
for (const file of [...rootDocuments, ...await markdownFiles(join(root, 'docs'))]) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const target = resolve(file, '..', decodeURIComponent(link));
    if (!target.startsWith(root)) throw new Error(`Documentation link escapes the package: ${link}`);
    await stat(target);
  }
}
console.log('Syntax, exports, src-only root layout, locales, display resources and local documentation links checked. No compilation required (native ESM).');
