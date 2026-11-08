import { SkillStore, skillId } from './store.js';
import { probeFile } from './file-probe.js';
import { groupSkillInstances } from './grouping.js';
import { createFileActions } from './file-actions.js';
import { createPolicyActions } from './policy-actions.js';
import { fileAvailability, withAvailability } from './management-availability.js';
import { isAbsolute, resolve } from 'node:path';

/** Application operations shared by UI, tools and other Cordis plugins. */
export function createSkillManager({ adapter, filename, config, publish = () => {}, now = () => new Date().toISOString(), probe = probeFile, fileActionsFactory = createFileActions, invocationRuntimeFactory }) {
  const store = new SkillStore(filename, { now });
  const management = new Map(), plans = new Map();
  let storageClosed = false;
  const protectedRoots = [...(config.protectedSkillDirs ?? [])];
  if (process.env.DSH_BUNDLED_SKILL_DIR && isAbsolute(process.env.DSH_BUNDLED_SKILL_DIR)) protectedRoots.push(process.env.DSH_BUNDLED_SKILL_DIR);
  const state = {
    get: id => storageClosed ? null : store.get(id), getControl: id => storageClosed ? null : store.getControl(id), listControls: () => storageClosed ? [] : store.listControls(),
    saveControl: (...args) => { if (storageClosed) throw new Error('Skill action storage is closed'); return store.saveControl(...args); },
  };
  const files = fileActionsFactory({ state, config, now, protectedRoots });
  let contexts = [], warnings = [], updatedAt = now(), flight = null, work = null, actionFlight = null, disposed = false, dirty = false;
  const controller = new AbortController();
  const listeners = new Set(), buffered = [];
  const persistentWarnings = new Map();
  const notify = type => {
    const event = Object.freeze({ apiVersion: 1, type, at: now() });
    for (const listener of listeners) { try { listener(event); } catch { /* Observers cannot veto committed state. */ } }
    try { publish(event); } catch { /* Cordis consumers cannot veto committed state. */ }
  };
  const fail = (code, message) => { persistentWarnings.set(code, { code, message }); notify('health'); };
  const invocationRuntime = invocationRuntimeFactory?.({
    disabled: () => state.listControls().filter(row => row.control.invocationOverride?.disabled === true || row.control.pending).map(row => state.get(row.id)).filter(Boolean),
    config, onChange: () => fail('policy-synchronization', 'An invocation policy synchronization failed. Affected new requests fail closed until their next successful synchronization.'),
  }) ?? { supported: false, sync: async () => {}, attach: () => () => {}, dispose: async () => {} };
  const policy = createPolicyActions({ state, runtime: invocationRuntime, config, now, report: fail });
  const detachPolicy = invocationRuntime.attach();
  async function assess(skill) {
    const current = { ...skill, status: skill.file?.status ?? skill.status };
    const file = await files.describe(current), control = state.getControl(skill.id);
    if (control?.pending || control?.archive || control?.deleted) return { ...file, mode: 'file' };
    if (file.eligible && !control?.invocationOverride?.disabled) return { ...file, mode: 'file' };
    // A protected file is not necessarily present. Never turn a failed file inspection into an enabled override.
    const presence = skill.path ? await fileAvailability(skill.path) : { status: current.status };
    const status = current.status === 'present' ? presence.status : current.status;
    const override = policy.describe({ ...current, file: undefined, status });
    return override.eligible || control?.invocationOverride?.disabled ? override : withAvailability({ ...current, status }, { ...file, mode: 'file' });
  }
  const commit = (operation, type) => {
    try { operation(); notify(type); }
    catch { fail('observation-write-failed', 'An observation could not be persisted. Counts or lifecycle history may be incomplete; check storage and restart the plugin.'); }
  };
  const accept = (type, payload) => {
    if (disposed) return;
    const operation = () => type === 'invocation' ? store.invocation(payload) : store.mutation(payload);
    if (flight) {
      if (buffered.length < config.observationCacheSize) { buffered.push({ operation, type }); return; }
      fail('observation-buffer-full', 'Observation buffer reached its configured limit; unresolved identities may appear.');
    }
    commit(operation, type);
  };
  const detach = adapter.attach({
    invocation: event => accept('invocation', event),
    mutation: event => { accept('mutation', event); },
    changed: () => { if (flight) dirty = true; else if (!disposed) schedule(); },
  });
  let timer;
  function schedule() {
    if (timer || disposed) return;
    timer = setTimeout(() => { timer = undefined; void refresh().catch(() => {}); }, config.debounceMs);
    timer.unref?.();
  }
  async function scan(signal) {
      const found = await adapter.discover({ signal });
      signal.throwIfAborted();
      const checks = new Map();
      const check = path => {
        if (!checks.has(path)) checks.set(path, probe(path, { maxFileBytes: config.maxFileBytes, signal }));
        return checks.get(path);
      };
      const observations = [];
      const fileWarnings = [];
      for (const observation of found.observations) {
        const context = found.contexts.find(value => value.id === observation.contextId);
        const skills = [];
        for (const item of observation.skills) {
          signal.throwIfAborted();
          // Catalog metadata only: never persist instruction content or arbitrary provider metadata.
          const summary = { name: item.name, description: item.description, source: item.source, provider: item.provider,
            path: item.path ?? null, resourceBase: item.resourceBase ?? null, invocation: item.invocation };
          const file = summary.path ? await check(summary.path) : { status: 'present' };
          if (file.warning) fileWarnings.push({ code: file.warning, message: `${item.name}: ${file.warning}` });
          skills.push({ ...summary, id: skillId(summary), file });
        }
        observations.push({ ...observation, cwd: context?.cwd ?? null, skills });
      }
      signal.throwIfAborted();
      // Finish every fallible I/O read before publishing any part of this refresh.
      const physical = [], proposed = new Map(store.snapshot().map(skill => [skill.id, skill]));
      for (const skill of proposed.values()) {
        if (skill.path) { const file = await check(skill.path); physical.push([skill.id, file]); proposed.set(skill.id, { ...skill, status: file.status }); }
      }
      for (const observation of observations) for (const skill of observation.skills) proposed.set(skill.id, { ...skill, status: skill.file.status });
      const assessed = new Map();
      for (const skill of proposed.values()) {
        signal.throwIfAborted();
        assessed.set(skill.id, await assess(skill));
      }
      signal.throwIfAborted();
      const at = now();
      store.observe(observations, { at });
      // Incomplete/truncated enumeration cannot retire an omitted scope.
      if (!found.warnings.some(warning => ['context-limit', 'preset-list-failed', 'preset-unavailable', 'registry-unavailable'].includes(warning.code))) store.reconcileContexts(found.contexts.map(value => value.id), at);
      // A skill losing precedence or a provider is not evidence its file was deleted.
      for (const [id, file] of physical) store.physical(id, file, at);
      management.clear(); for (const [id, capability] of assessed) management.set(id, capability);
      contexts = found.contexts;
      warnings = [...found.warnings, ...fileWarnings];
      updatedAt = at;
      persistentWarnings.delete('refresh-failed');
      notify('inventory');
  }
  function refresh() {
    if (disposed) return Promise.reject(new Error('Skill manager is disposed'));
    if (actionFlight) return actionFlight.then(() => refresh(), () => refresh());
    if (flight) return flight;
    // Do not accumulate concurrent provider leases after a timed-out uncooperative call.
    if (work) return Promise.reject(new Error('A timed-out inventory operation is still draining'));
    dirty = false;
    const scanController = new AbortController();
    const signal = AbortSignal.any([controller.signal, scanController.signal]);
    const timeout = setTimeout(() => scanController.abort(new Error('Inventory refresh timed out')), config.scanTimeoutMs);
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const task = scan(signal);
    work = task;
    // Late results encounter an abort check before storage; adapter finally retains ownership of its lease.
    void task.finally(() => { if (work === task) work = null; if (dirty && !disposed) schedule(); }).catch(() => {});
    flight = Promise.race([task, interrupted]).catch(error => {
      if (!disposed) fail('refresh-failed', 'Inventory refresh failed or timed out. Previous inventory remains readable. A provider ignoring cancellation must settle before another scan can start.');
      throw error;
    }).finally(() => {
      clearTimeout(timeout); signal.removeEventListener('abort', onAbort);
      flight = null;
      for (const { operation, type } of buffered.splice(0)) { commit(operation, type); if (type === 'mutation') dirty = true; }
      if (dirty && !work && !disposed) schedule();
    }).then(() => disposed ? undefined : snapshot());
    return flight;
  }
  const unavailableManagement = () => ({ eligible: false, reasonCode: 'not-checked', reason: 'Refresh the catalog before managing this instance.', workingStatus: 'unknown', fileStatus: 'unknown', allowedActions: [], revision: null });
  const decorate = skill => {
    const capability = withAvailability(skill, structuredClone(management.get(skill.id) ?? unavailableManagement()));
    if (actionFlight && capability.eligible) { capability.allowedActions = []; capability.reasonCode = 'operation-running'; capability.reason = 'An owner-authorized filesystem operation is running.'; }
    return { ...skill, management: capability };
  };
  function actionError(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }
  async function prepareAction(input) {
    if (disposed) throw actionError('disposed', 'Skill manager is disposed', 410);
    if (actionFlight) throw actionError('operation-running', 'Another owner-authorized operation is running');
    const skill = state.get(input?.id);
    if (!skill) throw actionError('not-found', 'Skill instance not found', 404);
    const capability = await assess(skill);
    if (!capability.eligible || !capability.allowedActions.includes(input?.action)) throw actionError(capability.workingStatus === 'unavailable' ? 'unavailable' : 'protected', capability.reason ?? 'This action is unavailable for the selected instance', capability.workingStatus === 'unavailable' ? 409 : 403);
    const plan = capability.mode === 'override' ? await policy.prepare(input) : await files.prepare(input);
    plan.mode = capability.mode;
    if (disposed) throw actionError('disposed', 'Skill manager is disposed', 410);
    const selected = store.get(plan.id);
    if (selected?.path) {
      const shared = store.snapshot().filter(skill => skill.id !== selected.id && skill.path && resolve(skill.path) === resolve(selected.path));
      if (shared.length) plan.warnings.push(`${shared.length} other catalog entries refer to the same physical instruction file and may also reflect this change.`);
    }
    for (const [token, value] of plans) if (Date.parse(value.expiresAt) <= Date.parse(now())) plans.delete(token);
    plans.set(plan.token, { id: plan.id, operationId: plan.operationId, expiresAt: plan.expiresAt, mode: capability.mode, action: plan.action });
    return plan;
  }
  function executeAction(input) {
    if (disposed) return Promise.reject(actionError('disposed', 'Skill manager is disposed', 410));
    if (actionFlight) return Promise.reject(actionError('operation-running', 'Another owner-authorized operation is running'));
    const owner = plans.get(input?.token);
    if (!owner) return Promise.reject(actionError('expired', 'The confirmation plan is unknown, consumed or expired', 410));
    plans.delete(input.token);
    const task = (async () => {
      if (flight) { try { await flight; } catch { /* A degraded catalog does not authorize a mutation; files.execute revalidates its own plan. */ } }
      if (disposed) throw actionError('disposed', 'Skill manager is disposed', 410);
      try {
        const selected = state.get(owner.id);
        const capability = selected && await assess(selected);
        if (!capability?.eligible || !capability.allowedActions.includes(owner.action)) throw actionError('unavailable', capability?.reason ?? 'The instance is no longer available; refresh before preparing a new action');
        const result = await (owner.mode === 'override' ? policy.execute(input) : files.execute(input));
        const { writeEvidence, ...publicResult } = result;
        if (writeEvidence) {
          try {
            const current = await probe(writeEvidence.path, { maxFileBytes: config.maxFileBytes });
            if (current.status === 'present' && current.version && current.contentHash === writeEvidence.contentHash) store.mutation({
              eventKey: `owner-action:${result.operationId}`, path: writeEvidence.path, at: now(), actor: { kind: 'user', label: 'Owner UI' },
              observation: { kind: 'present', version: current.version },
            });
          } catch { fail('management-writer-evidence-unavailable', 'The file action completed, but current revision authorship could not be verified.'); }
        }
        return publicResult;
      }
      finally {
        if (owner && !disposed) {
          try { const skill = store.get(owner.id); if (skill) management.set(owner.id, await assess(skill)); }
          catch { management.set(owner.id, unavailableManagement()); fail('management-inspection-failed', 'The file operation outcome needs a fresh catalog/status check.'); }
        }
      }
    })();
    actionFlight = task.finally(() => {
      actionFlight = null;
      if (!disposed) { notify('management'); schedule(); }
    });
    return actionFlight;
  }
  function actionStatus(input) {
    if (disposed) throw actionError('disposed', 'Skill manager is disposed', 410);
    const result = files.operationStatus(input);
    return result.status === 'unknown' ? policy.operationStatus(input) : result;
  }
  function snapshot() {
    if (disposed) throw new Error('Skill manager is disposed');
    const skills = store.snapshot(now()).map(decorate);
    return { apiVersion: 1, identityVersion: 2, updatedAt, contexts: structuredClone(contexts), warnings: structuredClone([...warnings, ...persistentWarnings.values()]),
      coverage: { since: store.since(), mode: 'observed', notes: [
        'Counts cover observed instruction-load attempts while this plugin is enabled, including failures; not task or script executions.',
        'Pre-install history and disabled/offline intervals are not backfilled. All-time means all recorded observations, not a proven lifetime total.',
        'Catalogs expose effective winners only. Hidden same-name candidates are not enumerable through the public DSH registry.',
        'Creation time is filesystem birthtime when available, not proof of original authorship. Unknown writers remain unknown.',
      ] }, skills, groups: groupSkillInstances(skills) };
  }
  const interval = setInterval(() => { void refresh().catch(() => {}); }, config.scanIntervalMs);
  interval.unref?.();
  return {
    apiVersion: 1,
    snapshot,
    refresh,
    detail: (id, pagination) => { if (disposed) throw new Error('Skill manager is disposed'); const value = store.detail(id, pagination); return value ? { ...value, skill: decorate(value.skill) } : null; },
    // Kept off the public read-only Cordis service and agent tool; only authenticated owner routes call these.
    prepareAction, executeAction, actionStatus,
    subscribe(listener) {
      if (disposed) throw new Error('Skill manager is disposed');
      if (typeof listener !== 'function') throw new TypeError('A listener function is required');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      detach(); controller.abort(); clearInterval(interval); clearTimeout(timer); listeners.clear();
      // Reject unadmitted plans and quiesce admitted mutations before closing their journal.
      detachPolicy?.();
      await Promise.allSettled([flight, actionFlight, files.dispose(), policy.dispose(), invocationRuntime.dispose()]);
      plans.clear(); management.clear(); storageClosed = true;
      store.close();
    },
  };
}
