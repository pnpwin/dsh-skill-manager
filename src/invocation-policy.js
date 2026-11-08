/** Agent-scoped, owner-persisted invocation denies; packaged instruction files are never edited or loaded here. */
import { createHash, randomUUID } from 'node:crypto';
import { skillId } from './identity.js';

const blocked = () => ({ modelInvocable: false, userInvocable: false });
const failure = () => Object.assign(new Error('Skill invocation policy could not be verified; this step is blocked until policy synchronization succeeds.'), { code: 'policy-unavailable', status: 409 });
const nameOf = exec => exec?.arguments && typeof exec.arguments === 'object' ? exec.arguments.name : undefined;

/** Register only through agent-owned child fibers; manager unload also disposes those exact fibers. */
export function createInvocationPolicyRuntime({ ctx, disabled, config = {}, onChange = () => {} }) {
  const timeoutMs = config.policySyncTimeoutMs ?? 10000, maxAgents = config.policyMaxAgents ?? 1024;
  const nonce = randomUUID(), bindings = new Map(), issued = new Map(), operations = new Set();
  const publicSkills = ctx.get?.('skills'), publicTools = ctx.get?.('tools');
  const supported = !!(ctx.on && ctx.effect && publicSkills?.snapshot && publicSkills?.registerProvider && publicTools?.guard);
  const lifecycle = new AbortController();
  let closed = false, attachment = null;
  const rules = () => new Map(disabled().map(skill => [skillId(skill), skill]));
  const report = () => { try { onChange({ code: 'policy-sync-failed', message: 'Skill invocation restrictions could not be applied in one or more agents.' }); } catch { /* Health observers cannot weaken enforcement. */ } };
  const assertOpen = () => { if (closed) throw failure(); };

  function normalizeSummary(summary) {
    const proof = issued.get(summary?.provider);
    if (!proof || summary.invocation?.modelInvocable !== false || summary.invocation?.userInvocable !== false) return summary;
    const original = { ...summary, provider: proof.provider };
    return proof.ids.has(skillId(original)) ? original : summary;
  }
  function track(promise) {
    operations.add(promise);
    void promise.finally(() => operations.delete(promise)).catch(() => {});
    return promise;
  }
  function until(promise, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(failure());
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async function removeProviders(binding) {
    for (const dispose of binding.providers.splice(0)) await dispose();
  }
  async function bindingFor(agent) {
    let binding = bindings.get(agent);
    if (binding) { await binding.ready; return binding; }
    assertOpen();
    if (bindings.size >= maxAgents) throw failure();
    binding = { agent, providers: [], tail: Promise.resolve(), registry: null, context: null, cwd: null, winners: new Map(), failed: true, fiber: null,
      abort: new AbortController(), guardDispose: null, guard: null };
    bindings.set(agent, binding);
    const owned = Object.assign(function skillManagerInvocationPolicy(child) {
      binding.context = child;
      // Calling serviceFor through the child context preserves exact agent scope and child-fiber ownership.
      const presets = child.get('agentPresets');
      binding.registry = presets?.serviceFor(agent, 'skills') ?? child.get('skills');
      const tools = presets?.serviceFor(agent, 'tools') ?? child.get('tools');
      if (!binding.registry?.snapshot || !binding.registry?.registerProvider || !tools?.guard) throw failure();
      binding.guard = exec => {
        if (exec.agent !== agent || exec.name !== 'skill') return;
        const name = nameOf(exec), denied = rules();
        const winner = binding.winners.get(name);
        if (winner && denied.has(winner)) return 'This skill is disabled by the profile owner.';
        if (binding.failed && [...denied.values()].some(skill => skill.name === name)) return 'Skill invocation policy is unavailable; retry after synchronization.';
      };
      binding.guardDispose = tools.guard(binding.guard);
      child.effect(() => () => binding.abort.abort(failure()), 'skill-manager agent policy cancellation');
      // The root global pre-execute listener refreshes every actual tool realm; this fiber owns its realm's monotonic guard.
    }, { inject: ['skills', 'tools', 'workingDirectory'] });
    try {
      binding.fiber = agent.ctx.plugin(owned);
      binding.ready = binding.fiber.await ? binding.fiber.await() : Promise.resolve(binding.fiber);
      await binding.ready;
      if (!binding.context || !binding.registry) throw failure();
      assertOpen();
      return binding;
    } catch (error) {
      if (binding.fiber) await binding.fiber.dispose();
      bindings.delete(agent);
      throw failure();
    }
  }
  async function refreshBinding(binding, signal) {
    assertOpen(); signal.throwIfAborted();
    binding.failed = true;
    await removeProviders(binding);
    const presets = binding.context.get('agentPresets');
    binding.registry = presets?.serviceFor(binding.agent, 'skills') ?? binding.context.get('skills');
    const tools = presets?.serviceFor(binding.agent, 'tools') ?? binding.context.get('tools');
    if (!binding.registry?.snapshot || !binding.registry?.registerProvider || !tools?.guard) throw failure();
    binding.guardDispose?.();
    binding.guardDispose = tools.guard(binding.guard);
    const selected = rules();
    if (!selected.size) { binding.winners.clear(); binding.failed = false; return; }
    const workingDirectory = binding.context.get('workingDirectory');
    // The skill consumer validates/recoveries cwd at this same operational boundary.
    const cwd = await until(workingDirectory.ensure(binding.agent, signal), signal);
    signal.throwIfAborted(); assertOpen();
    const snapshot = await binding.registry.snapshot({ scope: binding.agent, cwd, signal });
    signal.throwIfAborted(); assertOpen();
    if (!snapshot.complete) throw failure();
    binding.cwd = cwd;
    binding.winners = new Map(snapshot.skills.map(summary => [summary.name, skillId(normalizeSummary(summary))]));
    const byProvider = new Map();
    for (const summary of snapshot.skills) {
      const original = normalizeSummary(summary), id = skillId(original);
      if (!selected.has(id)) continue;
      const entries = byProvider.get(original.provider) ?? [];
      entries.push(structuredClone(original)); byProvider.set(original.provider, entries);
    }
    if (workingDirectory.get && workingDirectory.get(binding.agent.session) !== cwd) throw failure();
    for (const [provider, summaries] of byProvider) {
      signal.throwIfAborted(); assertOpen();
      const label = `pnpwin-skill-policy-${nonce}-${createHash('sha256').update(provider).digest('hex')}`;
      const proof = issued.get(label) ?? { provider, ids: new Set() };
      for (const summary of summaries) proof.ids.add(skillId(summary));
      issued.set(label, proof);
      const candidates = summaries.map(summary => ({ ...summary, provider: label, invocation: blocked(), rank: -Number.MAX_VALUE, locator: summary }));
      const dispose = binding.registry.registerProvider(() => ({
        name: label,
        list: options => Promise.resolve(options.cwd === cwd ? candidates : []),
        // User-explicit loading reaches get before its userInvocable check. No supplier body is read.
        get: candidate => Promise.resolve({ ...candidate.locator, invocation: blocked(), content: '' }),
      }));
      binding.providers.push(dispose);
    }
    const applied = await binding.registry.snapshot({ scope: binding.agent, cwd, signal });
    signal.throwIfAborted(); assertOpen();
    if (!applied.complete) throw failure();
    for (const summaries of byProvider.values()) for (const summary of summaries) {
      const actual = applied.skills.find(skill => skill.name === summary.name);
      if (!actual || !issued.has(actual.provider) || skillId(normalizeSummary(actual)) !== skillId(summary)
        || actual.invocation.modelInvocable || actual.invocation.userInvocable) throw failure();
    }
    binding.failed = false;
  }
  function sync(agent, externalSignal) {
    if (!rules().size) {
      if (agent) return bindings.has(agent) ? track(release(agent)) : Promise.resolve();
      return track(Promise.all([...bindings.keys()].map(release)).then(() => undefined));
    }
    if (!agent) {
      const all = ctx.get('agents')?.list() ?? [];
      if (all.length > maxAgents) return Promise.reject(failure());
      return track(Promise.all(all.map(value => sync(value, externalSignal))).then(() => undefined));
    }
    const task = (async () => {
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(failure()), timeoutMs);
      const signal = AbortSignal.any([lifecycle.signal, timeout.signal, ...(externalSignal ? [externalSignal] : [])]);
      let binding;
      try {
        if (!supported) throw failure();
        binding = await until(bindingFor(agent), signal);
        const scopedSignal = AbortSignal.any([signal, binding.abort.signal]);
        const queued = binding.tail.then(async () => { assertOpen(); await refreshBinding(binding, scopedSignal); });
        binding.tail = queued.catch(() => {});
        await until(queued, scopedSignal);
      } catch { if (binding) binding.failed = true; report(); throw failure(); }
      finally { clearTimeout(timer); }
    })();
    return track(task);
  }
  async function release(agent) {
    const binding = bindings.get(agent);
    if (!binding) return;
    binding.abort.abort(failure());
    if (binding.fiber) await binding.fiber.dispose();
    try { await binding.ready; await binding.tail; } catch { /* Cancelled preparation still owns removable provider handles. */ }
    await removeProviders(binding);
    bindings.delete(agent);
  }
  function attach() {
    assertOpen();
    if (attachment) return attachment.dispose;
    if (typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') { report(); return () => {}; }
    const stops = [];
    stops.push(ctx.on('agent/pre-step', async ({ agent, signal }, next) => { await sync(agent, signal); return next(); }, { prepend: true, global: true }));
    stops.push(ctx.on('agent/created', async ({ agent, signal }) => { await sync(agent, signal); }, { global: true }));
    stops.push(ctx.on('agent/disposed', ({ agent }) => { void track(release(agent)).catch(report); }, { global: true }));
    // A direct tool invocation outside an Agent cannot select an exact managed instance safely.
    stops.push(ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'skill') {
        if (exec.agent) await sync(exec.agent, exec.signal);
        else if ([...rules().values()].some(skill => skill.name === nameOf(exec))) throw failure();
      }
      return next();
    }, { prepend: true, global: true }));
    const dispose = () => { for (const stop of stops.splice(0).reverse()) stop(); attachment = null; };
    attachment = { dispose };
    ctx.effect(() => dispose, 'skill-manager invocation policy hooks');
    ctx.effect(() => () => disposeRuntime(), 'skill-manager invocation policy agent fibers');
    return dispose;
  }
  async function disposeRuntime() {
    if (closed) { await Promise.allSettled([...operations]); return; }
    closed = true; lifecycle.abort(failure()); attachment?.dispose();
    await Promise.allSettled([...operations]);
    await Promise.all([...bindings.keys()].map(release));
  }
  return { supported, normalizeSummary, sync, attach, dispose: disposeRuntime };
}
