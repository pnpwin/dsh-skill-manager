/** Owner-authorized local skill actions with bounded plans and a durable recovery journal. */
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open, mkdir, rename, link, unlink, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, isAlias } from 'yaml';
import { configuredStatus, withAvailability } from './management-availability.js';

const SOURCES = new Set(['project-dsh', 'project-agents', 'user-dsh', 'user-agents', 'custom']);
const ACTIONS = new Set(['enable', 'disable', 'archive', 'restore', 'delete']);
const FLAGS = ['disable-model-invocation', 'user-invocable'];
const OWNER = Object.freeze({ kind: 'user', label: 'Owner UI' });
const ARCHIVE = '.dsh-skill-manager-archive';
const hash = value => createHash('sha256').update(value).digest('hex');
const own = (value, key) => Object.hasOwn(value, key);
const within = (root, path) => path === root || path.startsWith(root + sep);
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const absent = error => error?.code === 'ENOENT';
const statKey = info => [String(info.dev), String(info.ino), String(info.mode), String(info.nlink), String(info.size), String(info.mtimeNs), String(info.ctimeNs)];

/** State persists control JSON and its lifecycle event atomically before each filesystem phase. */
export function createFileActions({ state, config = {}, now = () => new Date().toISOString(), protectedRoots = [] }) {
  const maxFiles = config.actionMaxFiles ?? 10000, maxBytes = config.actionMaxBytes ?? 67108864;
  const ttl = config.actionTokenTtlMs ?? 120000, maxPlans = config.actionMaxPlans ?? 128;
  const providers = new Set(['filesystem', ...(config.additionalFilesystemProviders ?? [])]);
  const roots = [fileURLToPath(new URL('../', import.meta.url)), ...(config.protectedSkillDirs ?? []), ...protectedRoots].map(path => resolve(path));
  const plans = new Map(), statuses = new Map(), running = new Map();
  let rootsReady;
  const canonicalRoots = () => rootsReady ??= Promise.all(roots.map(async root => {
    try { return await realpath(root); } catch { return root; }
  })).then(values => { for (const value of values) if (!roots.includes(value)) roots.push(value); });
  let closing = false, tail = Promise.resolve();
  const instant = () => { const value = now(); return typeof value === 'number' ? value : Date.parse(value); };
  const stamp = () => new Date(instant()).toISOString();
  const checkOpen = () => { if (closing) throw fail('disposed', 'Skill actions are unavailable after unload.', 410); };
  const save = (id, control, kind, details = {}, expectedControl) => {
    try { state.saveControl(id, control, kind, details, OWNER, expectedControl); }
    catch (error) {
      if (error.status) throw error;
      throw fail('journal-failed', 'The durable action journal could not be written; no further filesystem changes are authorized.', 500);
    }
  };
  const reason = (reasonCode, reasonText, fileStatus = 'unknown') => ({ eligible: false, reasonCode, reason: reasonText,
    workingStatus: 'unknown', fileStatus, allowedActions: [], revision: null });

  async function existing(path) { try { return await lstat(path, { bigint: true }); } catch (error) { if (absent(error)) return null; throw error; } }
  function lexicalProtection(path) {
    const parts = resolve(path).split(sep).map(part => part.toLowerCase());
    if (parts.some(part => part === 'node_modules' || part.endsWith('.asar') || part.endsWith('.asar.unpacked'))) throw fail('protected', 'Application and package files cannot be managed.', 403);
    if (roots.some(root => within(root, resolve(path)))) throw fail('protected', 'This path belongs to a protected package.', 403);
  }
  async function safePath(path, { missingLeaf = false } = {}) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw fail('protected', 'Only absolute local filesystem paths are supported.', 403);
    path = resolve(path); lexicalProtection(path);
    const chain = [];
    for (let current = path;; current = dirname(current)) { chain.push(current); if (dirname(current) === current) break; }
    for (const current of chain.reverse()) {
      const info = await existing(current);
      if (!info && missingLeaf && current === path) continue;
      if (!info) throw fail('missing', 'The instruction file or its parent is missing.');
      if (info.isSymbolicLink()) throw fail('protected', 'Symbolic links are not managed.', 403);
      if (current !== path && !info.isDirectory()) throw fail('protected', 'A path ancestor is not a directory.', 403);
    }
    const canonical = missingLeaf && !await existing(path) ? join(await realpath(dirname(path)), basename(path)) : await realpath(path);
    lexicalProtection(canonical);
    if (canonical !== path) throw fail('protected', 'Path aliases are not managed.', 403);
    return path;
  }
  async function readStable(path, info, limit, collect = false) {
    if (!info.isFile() || info.size > BigInt(limit)) throw fail('limit', 'A filesystem input exceeds its configured read limit.', 400);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const expected = JSON.stringify(statKey(info));
      if (JSON.stringify(statKey(await handle.stat({ bigint: true }))) !== expected) throw fail('conflict', 'A file changed before inspection.');
      const digest = createHash('sha256'), chunks = [], buffer = Buffer.alloc(65536);
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > limit || position > Number(info.size)) throw fail('conflict', 'A file grew during inspection.');
        const chunk = buffer.subarray(0, bytesRead);
        digest.update(chunk);
        if (collect) chunks.push(Buffer.from(chunk));
      }
      if (position !== Number(info.size) || JSON.stringify(statKey(await handle.stat({ bigint: true }))) !== expected) throw fail('conflict', 'A file changed during inspection.');
      return { hash: digest.digest('hex'), ...(collect ? { bytes: Buffer.concat(chunks) } : {}) };
    } finally { await handle.close(); }
  }
  async function checkManifest(directory) {
    const manifest = join(directory, 'package.json'), info = await existing(manifest);
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink() || info.size > BigInt(config.maxFileBytes ?? 1048576)) throw fail('protected', 'Package ownership could not be established safely.', 403);
    let metadata;
    try { metadata = JSON.parse((await readStable(manifest, info, config.maxFileBytes ?? 1048576, true)).bytes.toString('utf8')); }
    catch { throw fail('protected', 'Unreadable package ownership metadata.', 403); }
    if (metadata?.dsh && typeof metadata.dsh === 'object' && (own(metadata.dsh, 'bundle') || own(metadata.dsh, 'client'))) throw fail('protected', 'This skill is supplied by an installed plugin.', 403);
  }
  async function packageProtection(path) {
    for (let directory = dirname(path);; directory = dirname(directory)) {
      await checkManifest(directory);
      if (dirname(directory) === directory) break;
    }
  }
  async function tree(path) {
    const entries = [], root = await existing(path);
    if (!root) throw fail('missing', 'The managed target is missing.');
    let count = 0, bytes = 0;
    async function visit(current, rel) {
      lexicalProtection(current);
      const info = await lstat(current, { bigint: true });
      if (info.isDirectory()) await checkManifest(current);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw fail('protected', 'Links and special filesystem entries are not managed.', 403);
      if (info.dev !== root.dev) throw fail('protected', 'Nested mount points are not managed.', 403);
      if (info.isFile() && info.nlink !== 1n) throw fail('protected', 'Hard-linked files are not managed.', 403);
      const item = { relative: rel, kind: info.isDirectory() ? 'directory' : 'file', metadata: statKey(info), mode: Number(info.mode & 0o777n) };
      if (info.isFile()) {
        count++; bytes += Number(info.size);
        if (count > maxFiles || bytes > maxBytes) throw fail('limit', 'The skill exceeds the configured action file or byte limit.', 400);
        item.hash = (await readStable(current, info, maxBytes)).hash;
      }
      entries.push(item);
      if (info.isDirectory()) for (const name of (await readdir(current)).sort()) {
        if (entries.length >= maxFiles * 2 + 1) throw fail('limit', 'The skill contains too many filesystem entries.', 400);
        await visit(join(current, name), rel ? join(rel, name) : name);
      }
      if (JSON.stringify(statKey(await lstat(current, { bigint: true }))) !== JSON.stringify(item.metadata)) throw fail('conflict', 'A directory changed during inspection.');
    }
    await visit(path, '');
    return { entries, fileCount: count, totalBytes: bytes, revision: hash(JSON.stringify(entries)),
      // Rename/link changes ctime; restored directories have new inodes. Content is verified independently.
      content: hash(JSON.stringify(entries.map(item => [item.relative, item.kind, item.mode, item.hash ?? null]))),
      identity: `${root.dev}:${root.ino}` };
  }
  function frontmatter(text) {
    const match = /^(---\r?\n)([\s\S]*?)(^---\r?$)(\r?\n|$)/m.exec(text);
    if (!match || match.index !== 0) throw fail('invalid', 'A valid YAML frontmatter block is required.', 400);
    const doc = parseDocument(match[2], { uniqueKeys: true });
    if (doc.errors.length || !doc.contents || !doc.contents.items) throw fail('invalid', 'Skill YAML frontmatter cannot be edited safely.', 400);
    let value;
    try { value = doc.toJS(); } catch { throw fail('invalid', 'Skill frontmatter aliases cannot be resolved safely.', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('invalid', 'Skill frontmatter must be a mapping.', 400);
    for (const key of FLAGS) {
      const node = doc.get(key, true);
      if (isAlias(node) || node?.anchor) throw fail('invalid', 'Aliased or anchored invocation flags require a manual edit to preserve other metadata.', 400);
    }
    return { doc, value, prefix: match[1], closing: match[3] + match[4], body: text.slice(match[0].length), eol: match[1].includes('\r') ? '\r\n' : '\n' };
  }
  function boolean(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    if (typeof value === 'string' && /^(true|yes|on)$/i.test(value)) return true;
    if (typeof value === 'string' && /^(false|no|off)$/i.test(value)) return false;
    throw fail('invalid', 'Invocation policy is not a recognized boolean.', 400);
  }
  function working(parsed) { return !boolean(parsed.value[FLAGS[0]], false) || boolean(parsed.value[FLAGS[1]], true) ? 'enabled' : 'disabled'; }
  function originalPolicy(parsed) { return Object.fromEntries(FLAGS.map(key => [key, { present: own(parsed.value, key), ...(own(parsed.value, key) ? { value: parsed.value[key] } : {}) }])); }
  function changedPolicy(parsed, action, policy) {
    if (action === 'disable') { parsed.doc.set(FLAGS[0], true); parsed.doc.set(FLAGS[1], false); }
    else for (const key of FLAGS) {
      if (policy) { if (policy[key]?.present) parsed.doc.set(key, policy[key].value); else parsed.doc.delete(key); }
      else parsed.doc.set(key, key === FLAGS[0] ? false : true);
    }
    const yaml = parsed.doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, parsed.eol);
    return parsed.prefix + yaml + parsed.closing + parsed.body;
  }
  function instructionText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw fail('invalid', 'The instruction file is not valid UTF-8 text.', 400); }
  }
  async function inspect(skill, action) {
    if (!skill || !/^[a-f0-9]{64}$/.test(skill.id ?? '')) throw fail('invalid', 'A known per-instance skill id is required.', 400);
    if (!SOURCES.has(skill.source) || !providers.has(skill.provider)) throw fail('protected', 'Bundled, plugin, runtime, unknown and non-filesystem skills are read-only.', 403);
    if (typeof skill.path !== 'string' || !isAbsolute(skill.path)) throw fail('protected', 'Only absolute local instruction file paths can be managed.', 403);
    await canonicalRoots();
    const control = state.getControl(skill.id) ?? {};
    if (running.has(skill.id)) throw fail('operation-running', 'An admitted operation is still running for this instance.');
    if (control.pending) throw fail('recovery-required', 'An earlier operation needs owner recovery before further changes.');
    if (control.deleted) throw fail('deleted', 'This instance was permanently deleted.');
    const instruction = resolve(skill.path);
    lexicalProtection(instruction);
    await packageProtection(instruction);
    const parent = dirname(instruction);
    const ownsDirectory = basename(instruction) === 'SKILL.md' && basename(parent) === skill.name
      && skill.resourceBase?.kind === 'directory' && typeof skill.resourceBase.path === 'string' && isAbsolute(skill.resourceBase.path) && resolve(skill.resourceBase.path) === parent;
    const targetKind = ownsDirectory && !['enable', 'disable'].includes(action) ? 'directory' : 'file';
    const originalPath = targetKind === 'directory' ? parent : instruction;
    await safePath(control.archive?.originalPath ?? originalPath, { missingLeaf: true });
    let path = originalPath, instructionPath = instruction;
    if (control.archive) {
      const archive = control.archive;
      const expectedRoot = join(dirname(archive.originalPath), ARCHIVE, skill.id);
      if (!within(expectedRoot, archive.path) || relative(expectedRoot, archive.path).split(sep).length !== 2 || basename(archive.path) !== 'payload'
        || archive.originalPath !== (archive.targetKind === 'directory' ? parent : instruction)) throw fail('recovery-required', 'Archive ownership metadata is inconsistent.');
      if (!['restore', 'delete', undefined].includes(action)) throw fail('invalid', 'Restore the archived skill before changing invocation policy.', 400);
      path = archive.path; instructionPath = archive.targetKind === 'directory' ? join(path, 'SKILL.md') : path;
    }
    await safePath(path);
    const snapshot = await tree(path);
    const instructionInfo = await lstat(instructionPath, { bigint: true });
    if (!instructionInfo.isFile() || instructionInfo.size > BigInt(config.maxFileBytes ?? 1048576)) throw fail('invalid', 'The instruction file is too large or is not a regular file.', 400);
    const parsed = frontmatter(instructionText((await readStable(instructionPath, instructionInfo, config.maxFileBytes ?? 1048576, true)).bytes));
    if (parsed.value.name !== skill.name) throw fail('conflict', 'The instruction name no longer matches this catalog instance.');
    working(parsed);
    const kind = control.archive?.targetKind ?? targetKind;
    const actualOriginal = control.archive?.originalPath ?? originalPath;
    return { skill, control, originalPath: actualOriginal, path, instructionPath, targetKind: kind, snapshot, parsed,
      warnings: [...(kind === 'file' ? ['Only the instruction file is managed; shared or unowned resources are untouched.'] : []),
        'Instructions already loaded into running sessions are not removed by this action.',
        'Discovery may require a watcher update, catalog refresh, or DSH restart before all surfaces reflect the change.'] };
  }
  async function describe(skill) {
    try {
      const archived = !!state.getControl(skill?.id)?.archive;
      const found = await inspect(skill, archived ? undefined : 'disable');
      const policyAction = working(found.parsed) === 'disabled' ? 'enable' : 'disable';
      const allowedActions = archived ? ['restore', 'delete'] : [policyAction];
      let reasonCode = null, reasonText = null;
      if (!archived) {
        try { await inspect(skill); allowedActions.push('archive', 'delete'); }
        catch (error) {
          if (['operation-running', 'recovery-required'].includes(error.code)) throw error;
          reasonCode = 'file-actions-unavailable'; reasonText = error.status ? error.message : 'Resources cannot be managed safely; instruction policy remains editable.';
        }
      }
      return withAvailability(skill, { eligible: true, reasonCode, reason: reasonText, workingStatus: working(found.parsed), configuredWorkingStatus: working(found.parsed), fileStatus: archived ? 'archived' : 'active',
        allowedActions, revision: found.snapshot.revision });
    } catch (error) {
      const control = skill?.id ? state.getControl(skill.id) : null;
      return withAvailability(skill, { ...reason(error.code ?? 'unreadable', error.status ? error.message : 'The skill could not be inspected safely.', control?.deleted ? 'deleted' : control?.archive ? 'archived' : error.code === 'missing' ? 'missing' : 'unknown'), configuredWorkingStatus: configuredStatus(skill, control) });
    }
  }
  async function preparePlan({ id, action } = {}) {
    checkOpen();
    if (!ACTIONS.has(action)) throw fail('invalid', 'Unknown skill action.', 400);
    const skill = state.get(id), found = await inspect(skill, action);
    if (action === 'restore' && !found.control.archive) throw fail('invalid', 'This skill is not archived.', 400);
    if (action === 'disable' && working(found.parsed) === 'disabled') throw fail('conflict', 'This instance already disallows every invocation surface.');
    checkOpen();
    const token = randomUUID(), operationId = randomUUID(), expires = instant() + ttl;
    for (const [key, plan] of plans) if (plan.expires <= instant()) plans.delete(key);
    if (plans.size >= maxPlans) throw fail('limit', 'Too many pending confirmation plans.', 400);
    const plan = { token, operationId, id, action, name: skill.name, path: found.path, targetKind: found.targetKind, fileCount: found.snapshot.fileCount,
      totalBytes: found.snapshot.totalBytes, confirmationText: action === 'delete' ? skill.name : null, expiresAt: new Date(expires).toISOString(), warnings: found.warnings };
    plans.set(token, { plan, expires, revision: found.snapshot.revision, control: JSON.stringify(found.control), originalPath: found.originalPath });
    statuses.set(operationId, { id, operationId, action, status: 'not-started' });
    while (statuses.size > maxPlans) statuses.delete(statuses.keys().next().value);
    return structuredClone(plan);
  }

  function normalized(error) {
    if (error.status) return error;
    if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return fail('protected', 'Filesystem permissions or a path alias prevent this operation.', 403);
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EXDEV'].includes(error.code)) return fail('conflict', 'The filesystem target changed or crosses a filesystem.', 409);
    return fail('action-failed', 'The skill operation could not be completed safely.', 500);
  }
  async function prepare(input) { try { return await preparePlan(input); } catch (error) { throw normalized(error); } }

  async function ownedDirectory(path, exclusive = false) {
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (exclusive || error.code !== 'EEXIST') throw error; }
    await safePath(path);
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || (info.mode & 0o077n) !== 0n || (process.getuid && info.uid !== BigInt(process.getuid()))) throw fail('protected', 'The private action directory is not exclusively owned.', 403);
    return info;
  }
  async function createOperation(found, operationId) {
    const parent = dirname(found.originalPath);
    await safePath(parent);
    const root = join(parent, ARCHIVE), owned = join(root, found.skill.id), operation = join(owned, operationId);
    await ownedDirectory(root); await ownedDirectory(owned); await ownedDirectory(operation, true);
    const info = await lstat(operation, { bigint: true });
    const source = await lstat(found.path, { bigint: true });
    if (info.dev !== source.dev) throw fail('conflict', 'The target is a mount point or crosses a filesystem; no copying is performed.');
    return operation;
  }
  async function verify(path, snapshot, strict = true) {
    await safePath(path);
    const actual = await tree(path);
    if (strict ? actual.revision !== snapshot.revision : actual.content !== snapshot.content || actual.identity !== snapshot.identity) throw fail('conflict', 'The target changed after confirmation.');
    return actual;
  }
  async function syncDirectory(path) { const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
  async function removePrivate(path, snapshot) {
    const verified = await verify(path, snapshot, false);
    for (const entry of [...verified.entries].reverse()) {
      const target = entry.relative ? join(path, entry.relative) : path;
      if (!within(path, target) || !target.includes(`${sep}${ARCHIVE}${sep}`)) throw fail('protected', 'Refusing to purge outside private quarantine.', 403);
      await safePath(target);
      const info = await lstat(target, { bigint: true });
      if (`${info.dev}:${info.ino}` !== `${entry.metadata[0]}:${entry.metadata[1]}` || info.isSymbolicLink()) throw fail('conflict', 'A quarantined entry changed before purge.');
      if (entry.kind === 'directory') await rmdir(target);
      else {
        if (!info.isFile() || info.nlink !== 1n || JSON.stringify(statKey(info)) !== JSON.stringify(entry.metadata)) throw fail('conflict', 'A quarantined file changed before purge.');
        await unlink(target);
      }
    }
  }
  async function cleanupEmpty(operation, id, originalPath) {
    const root = join(dirname(originalPath), ARCHIVE), owner = join(root, id);
    if (dirname(operation) !== owner || !/^[a-f0-9-]{36}$/.test(basename(operation))) return;
    for (const path of [operation, owner, root]) {
      try {
        if (!await existing(path)) continue;
        await safePath(path);
        const info = await lstat(path, { bigint: true });
        if (!info.isDirectory() || (info.mode & 0o077n) !== 0n || (process.getuid && info.uid !== BigInt(process.getuid()))) return;
        // Only empty directories under the verified private operation root are removed.
        await rmdir(path);
      } catch { /* Empty-directory cleanup never purges content or changes the committed action result. */ return; }
    }
  }
  async function restoreNode(source, destination, snapshot) {
    // mkdir/link are exclusive: unlike rename, neither overwrites an existing destination.
    await verify(source, snapshot, false);
    const root = snapshot.entries[0];
    if (root.kind === 'file') {
      await link(source, destination); await unlink(source);
      await verify(destination, snapshot, false);
      return;
    }
    await mkdir(destination, { mode: root.mode });
    const destinationIdentity = statKey(await lstat(destination, { bigint: true })).slice(0, 2).join(':');
    const checkDestination = async () => {
      await safePath(destination);
      if (statKey(await lstat(destination, { bigint: true })).slice(0, 2).join(':') !== destinationIdentity) throw fail('conflict', 'The restore destination changed.');
    };
    for (const entry of snapshot.entries.slice(1)) {
      await checkDestination();
      const from = join(source, entry.relative), to = join(destination, entry.relative);
      await safePath(dirname(to)); await safePath(from);
      const info = await lstat(from, { bigint: true });
      if (`${info.dev}:${info.ino}` !== `${entry.metadata[0]}:${entry.metadata[1]}`) throw fail('conflict', 'An archived entry changed during restore.');
      if (entry.kind === 'directory') await mkdir(to, { mode: entry.mode });
      else { await link(from, to); await unlink(from); }
    }
    await checkDestination();
    const restored = await tree(destination);
    if (restored.content !== snapshot.content) throw fail('conflict', 'Restored resources differ from the confirmed archive.');
    for (const entry of [...snapshot.entries].reverse().filter(entry => entry.kind === 'directory')) await rmdir(entry.relative ? join(source, entry.relative) : source);
  }
  async function run({ token, confirmationText } = {}) {
    checkOpen();
    const saved = plans.get(token);
    if (!saved) throw fail('expired', 'The confirmation plan is unknown or expired.', 410);
    if (saved.expires <= instant()) { plans.delete(token); throw fail('expired', 'The confirmation plan expired.', 410); }
    if (saved.plan.action === 'delete' && confirmationText !== saved.plan.name) throw fail('invalid', 'Type the exact skill name to authorize permanent deletion.', 400);
    plans.delete(token);
    const { id, action } = saved.plan, skill = state.get(id), found = await inspect(skill, action);
    if (JSON.stringify(found.control) !== saved.control || found.originalPath !== saved.originalPath || found.path !== saved.plan.path || found.snapshot.revision !== saved.revision) throw fail('conflict', 'The target or its lifecycle state changed after confirmation.');
    if (action === 'restore' && await existing(found.originalPath)) throw fail('conflict', 'The restore destination already exists.');
    const operationId = saved.plan.operationId, destination = join(dirname(found.originalPath), ARCHIVE, id, operationId, 'payload');
    running.set(id, operationId);
    statuses.set(operationId, { id, operationId, action, status: 'running' });
    const control = { ...found.control, version: 1, ...(action === 'disable' ? { disabledPolicy: found.control.disabledPolicy ?? originalPolicy(found.parsed) } : {}),
      lastOperation: { id: operationId, action, status: 'running', at: stamp() },
      pending: { operationId, action, phase: 'intent', source: found.path, destination, originalPath: found.originalPath, targetKind: found.targetKind, revision: found.snapshot.revision, at: stamp() } };
    // Recheck after asynchronous inspection; the state provider also rejects another operation's pending intent atomically.
    if (JSON.stringify(state.getControl(id) ?? {}) !== saved.control) throw fail('conflict', 'The lifecycle journal changed before admission.');
    // If this fails, not even private directories have been created.
    save(id, control, 'action-intent', { action, operationId }, found.control);
    const phase = value => { control.pending.phase = value; save(id, control, 'action-phase', { action, operationId, phase: value }); };
    let writeEvidence;
    try {
      const operation = await createOperation(found, operationId);
      await verify(found.path, found.snapshot);
      if (action === 'restore') {
        phase('restore-authorized');
        await safePath(dirname(found.originalPath));
        await restoreNode(found.path, found.originalPath, found.snapshot);
        await syncDirectory(dirname(found.originalPath));
        delete control.archive;
      } else {
        await safePath(dirname(found.path));
        await rename(found.path, destination);
        await syncDirectory(dirname(found.path)); await syncDirectory(operation);
        await verify(destination, found.snapshot, false);
        phase('claimed');
        if (action === 'archive') control.archive = { path: destination, originalPath: found.originalPath, targetKind: found.targetKind, at: stamp() };
        else if (action === 'delete') {
          phase('purge-authorized');
          await removePrivate(destination, found.snapshot);
          control.deleted = true; delete control.archive;
        } else {
          const bytes = changedPolicy(found.parsed, action, found.control.disabledPolicy);
          const stage = join(operation, 'policy');
          const handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, found.snapshot.entries[0].mode);
          try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); } finally { await handle.close(); }
          phase('policy-publish-authorized');
          await safePath(dirname(found.originalPath));
          await link(stage, found.originalPath); await unlink(stage);
          await syncDirectory(dirname(found.originalPath));
          const current = await tree(found.originalPath);
          if (current.entries[0]?.hash !== hash(bytes)) throw fail('conflict', 'The published invocation policy changed unexpectedly.');
          writeEvidence = { path: found.originalPath, contentHash: hash(bytes) };
          phase('policy-published');
          await removePrivate(destination, found.snapshot);
          if (action === 'enable') delete control.disabledPolicy;
        }
      }
      delete control.pending;
      control.lastOperation = { id: operationId, action, status: 'succeeded', at: stamp() };
      save(id, control, 'action-completed', { action, operationId });
      statuses.set(operationId, { id, operationId, action, status: 'succeeded' });
      if (action !== 'archive') {
        await cleanupEmpty(dirname(destination), id, found.originalPath);
        if (found.control.archive) await cleanupEmpty(dirname(found.path), id, found.originalPath);
      }
      running.delete(id);
      return { id, action, operationId, management: await describe(state.get(id)), ...(writeEvidence ? { writeEvidence } : {}) };
    } catch (error) {
      // A persisted pending intent is authoritative. No speculative rollback overwrites a new source.
      throw fail('recovery-required', 'The operation did not finish. Source and private quarantine require owner recovery.', 409);
    }
  }
  function execute(input) {
    const operation = tail.then(async () => {
      const saved = plans.get(input?.token), identity = saved?.plan;
      try { return await run(input); }
      catch (error) {
        let outward = error;
        if (identity && statuses.get(identity.operationId)?.status === 'running') {
          const control = state.getControl(identity.id);
          const ownsPending = control?.pending?.operationId === identity.operationId;
          const status = ownsPending ? 'recovery-required' : 'failed';
          statuses.set(identity.operationId, { id: identity.id, operationId: identity.operationId, action: identity.action, status });
          if (ownsPending) {
            outward = fail('recovery-required', 'The operation did not finish. Source and private quarantine require owner recovery.', 409);
            try { save(identity.id, { ...control, lastOperation: { id: identity.operationId, action: identity.action, status, at: stamp() } }, 'action-recovery-required', { action: identity.action, operationId: identity.operationId }); }
            catch { /* The preceding durable pending intent still blocks further actions. */ }
          }
        }
        throw normalized(outward);
      } finally { if (identity) running.delete(identity.id); }
    });
    tail = operation.catch(() => {});
    return operation;
  }
  function operationStatus({ id, operationId } = {}) {
    if (typeof id !== 'string' || typeof operationId !== 'string') throw fail('invalid', 'Instance and operation ids are required.', 400);
    if (running.get(id) === operationId) return { id, operationId, action: state.getControl(id)?.lastOperation?.action, status: 'running' };
    const active = statuses.get(operationId);
    if (active?.id === id) return { ...active };
    const control = state.getControl(id);
    if (control?.lastOperation?.id === operationId) return { id, operationId, action: control.lastOperation.action,
      status: control.pending ? 'recovery-required' : control.lastOperation.status };
    return { id, operationId, status: 'unknown' };
  }
  async function dispose() { closing = true; plans.clear(); await tail; }
  return { describe, prepare, execute, operationStatus, dispose };
}
