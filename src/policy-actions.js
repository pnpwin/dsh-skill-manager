/** Confirmed owner-only invocation overrides; never edits provider or package files. */
import { createHash, randomUUID } from 'node:crypto';
import { canonicalResourceBase } from './identity.js';

const OWNER = Object.freeze({ kind: 'user', label: 'Owner UI' });
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const revision = skill => createHash('sha256').update(JSON.stringify({ id: skill.id, name: skill.name, provider: skill.provider,
  source: skill.source, path: skill.path ?? null, resourceBase: canonicalResourceBase(skill.resourceBase) })).digest('hex');
const known = skill => skill && /^[a-f0-9]{64}$/.test(skill.id ?? '') && typeof skill.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)
  && typeof skill.provider === 'string' && skill.provider.length > 0 && skill.provider !== 'unknown' && typeof skill.source === 'string' && skill.source.length > 0 && skill.source !== 'unknown';

/** A profile-local restriction removes both invocation surfaces; enable restores the provider's own policy. */
export function createPolicyActions({ state, runtime, config = {}, now = () => new Date().toISOString(), report = () => {} }) {
  const plans = new Map(), statuses = new Map();
  const maxPlans = config.actionMaxPlans ?? 128, ttl = config.actionTokenTtlMs ?? 120000;
  let closed = false, work = Promise.resolve();
  const time = () => Date.parse(now());
  const check = () => { if (closed) throw fail('disposed', 'Invocation policy management is unavailable after unload', 410); };
  function retain(operationId, value) {
    statuses.set(operationId, value);
    while (statuses.size > maxPlans) statuses.delete(statuses.keys().next().value);
  }
  function describe(skill) {
    const control = known(skill) ? state.getControl(skill.id) ?? {} : {};
    const allowed = known(skill) && runtime.supported && !control.pending && !control.archive && !control.deleted;
    const blocked = control.invocationOverride?.disabled === true;
    return {
      eligible: !!allowed, mode: 'override', reasonCode: allowed ? 'file-actions-protected' : !known(skill) ? 'unknown-instance' : control.pending ? 'recovery-required' : 'policy-unavailable',
      reason: allowed ? 'Only invocation policy can be changed here; provider/package files remain protected.' : 'Invocation policy cannot be verified or this instance requires recovery. No package files will be modified.',
      workingStatus: !allowed ? 'unknown' : blocked ? 'disabled' : skill.invocation?.modelInvocable || skill.invocation?.userInvocable ? 'enabled' : 'disabled',
      fileStatus: skill?.path ? skill.status === 'present' ? 'active' : skill.status === 'missing' ? 'missing' : 'unknown' : 'unknown',
      allowedActions: allowed ? [blocked ? 'enable' : 'disable'] : [], revision: known(skill) ? revision(skill) : null,
    };
  }
  function prepare({ id, action } = {}) {
    check();
    if (!['enable', 'disable'].includes(action)) throw fail('protected', 'Provider/package files cannot be archived, restored or deleted', 403);
    const skill = state.get(id), management = describe(skill);
    if (!management.eligible || !management.allowedActions.includes(action)) throw fail('protected', management.reason, 403);
    const instant = time();
    for (const [token, plan] of plans) if (Date.parse(plan.expiresAt) <= instant) plans.delete(token);
    if (plans.size >= maxPlans) throw fail('too-many-plans', 'Too many pending confirmations; wait for older plans to expire', 429);
    const plan = { mode: 'override', token: randomUUID(), operationId: randomUUID(), id: skill.id, action, name: skill.name,
      path: null, targetKind: 'policy', fileCount: 0, totalBytes: 0, confirmationText: null,
      expiresAt: new Date(instant + ttl).toISOString(), warnings: [
        'This stores a profile-local invocation override. Provider and package files are not changed.',
        'Disable affects new model/user skill loads. Already loaded instructions remain in existing session histories.',
        'Enable removes only the manager restriction; the provider\'s original invocation permissions are preserved.',
      ] };
    plans.set(plan.token, { ...plan, revision: management.revision });
    retain(plan.operationId, { id: plan.id, operationId: plan.operationId, action, status: 'not-started' });
    return structuredClone(plan);
  }
  function execute({ token, confirmationText } = {}) {
    check();
    const plan = plans.get(token);
    if (!plan || Date.parse(plan.expiresAt) <= time()) { plans.delete(token); throw fail('expired', 'The policy confirmation has expired or was consumed', 410); }
    if (confirmationText !== undefined) throw fail('invalid', 'Policy confirmation does not accept file-deletion confirmation text', 400);
    plans.delete(token);
    const operation = work.then(async () => {
      check();
      if (Date.parse(plan.expiresAt) <= time()) throw fail('expired', 'The policy confirmation expired before admission', 410);
      const skill = state.get(plan.id), previous = state.getControl(plan.id) ?? {};
      const capability = describe(skill);
      if (!capability.eligible || !capability.allowedActions.includes(plan.action) || revision(skill) !== plan.revision) throw fail('conflict', 'The selected definition or policy changed; prepare a new confirmation');
      const next = { ...previous, version: 1, lastOperation: { id: plan.operationId, action: plan.action, status: 'succeeded', mode: 'override', at: now() } };
      if (plan.action === 'disable') next.invocationOverride = { disabled: true, at: now() };
      else delete next.invocationOverride;
      state.saveControl(plan.id, next, plan.action === 'disable' ? 'invocation-disabled' : 'invocation-enabled',
        { operationId: plan.operationId, action: plan.action, mode: 'override' }, OWNER, previous);
      retain(plan.operationId, { id: plan.id, operationId: plan.operationId, action: plan.action, status: 'succeeded' });
      const warnings = [];
      try { await runtime.sync(); }
      catch (error) {
        warnings.push('The policy is saved, but an active scope needs synchronization. New affected requests will fail closed until synchronization succeeds.');
        report('policy-sync-incomplete', warnings[0]);
      }
      return { id: plan.id, action: plan.action, operationId: plan.operationId, management: describe(state.get(plan.id)), warnings };
    });
    work = operation.catch(() => {});
    return operation.catch(error => {
      const saved = state.getControl(plan.id)?.lastOperation;
      if (saved?.id !== plan.operationId) retain(plan.operationId, { id: plan.id, operationId: plan.operationId, action: plan.action, status: 'failed' });
      throw error;
    });
  }
  function operationStatus({ id, operationId } = {}) {
    const active = statuses.get(operationId);
    if (active?.id === id) return { ...active };
    const control = state.getControl(id);
    if (control?.lastOperation?.id === operationId) return { id, operationId, action: control.lastOperation.action,
      status: control.pending ? 'recovery-required' : control.lastOperation.status };
    return { id, operationId, status: 'unknown' };
  }
  async function dispose() { closed = true; plans.clear(); await work; }
  return { describe, prepare, execute, operationStatus, dispose };
}
