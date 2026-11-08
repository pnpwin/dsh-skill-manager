import { SkillStore, skillId } from './store.js';
import { probeFile } from './file-probe.js';
import { groupSkillInstances } from './grouping.js';

/** Application operations shared by UI, tools and other Cordis plugins. */
export function createSkillManager({ adapter, filename, config, publish = () => {}, now = () => new Date().toISOString(), probe = probeFile }) {
  const store = new SkillStore(filename, { now });
  let contexts = [], warnings = [], updatedAt = now(), flight = null, work = null, disposed = false, dirty = false;
  const controller = new AbortController();
  const listeners = new Set(), buffered = [];
  const persistentWarnings = new Map();
  const notify = type => {
    const event = Object.freeze({ apiVersion: 1, type, at: now() });
    for (const listener of listeners) { try { listener(event); } catch { /* Observers cannot veto committed state. */ } }
    try { publish(event); } catch { /* Cordis consumers cannot veto committed state. */ }
  };
  const fail = (code, message) => { persistentWarnings.set(code, { code, message }); notify('health'); };
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
      const physical = [];
      for (const skill of store.snapshot()) {
        if (skill.path) physical.push([skill.id, await check(skill.path)]);
      }
      signal.throwIfAborted();
      const at = now();
      store.observe(observations, { at });
      // Incomplete/truncated enumeration cannot retire an omitted scope.
      if (!found.warnings.some(warning => ['context-limit', 'preset-list-failed', 'preset-unavailable', 'registry-unavailable'].includes(warning.code))) store.reconcileContexts(found.contexts.map(value => value.id), at);
      // A skill losing precedence or a provider is not evidence its file was deleted.
      for (const [id, file] of physical) store.physical(id, file, at);
      contexts = found.contexts;
      warnings = [...found.warnings, ...fileWarnings];
      updatedAt = at;
      persistentWarnings.delete('refresh-failed');
      notify('inventory');
  }
  function refresh() {
    if (disposed) return Promise.reject(new Error('Skill manager is disposed'));
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
  function snapshot() {
    if (disposed) throw new Error('Skill manager is disposed');
    const skills = store.snapshot(now());
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
    detail: (id, pagination) => { if (disposed) throw new Error('Skill manager is disposed'); return store.detail(id, pagination); },
    subscribe(listener) {
      if (disposed) throw new Error('Skill manager is disposed');
      if (typeof listener !== 'function') throw new TypeError('A listener function is required');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      detach(); controller.abort(); clearInterval(interval); clearTimeout(timer); listeners.clear();
      try { await flight; } catch { /* A cancelled refresh must settle before SQLite closes. */ }
      store.close();
    },
  };
}
