import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createInvocationPolicyRuntime } from '../src/invocation-policy.js';
import { skillId } from '../src/identity.js';

// Optional real public SDK composition. No installation, sessions on disk, or private profiles are read.
const reference = process.env.DSH_REFERENCE_ROOT ? pathToFileURL(resolve(process.env.DSH_REFERENCE_ROOT) + '/') : new URL('../../dsh-github-updates/', import.meta.url);
const available = existsSync(new URL('packages/skill/skill/lib/index.js', reference));
const sdk = available ? await (async () => {
  const load = path => import(new URL(path, reference));
  const [cordis, skills, scope, tools, prompt, native, loader, session, llm, pipeline] = await Promise.all([
    load('vendor/cordis/lib/index.js'), load('packages/skill/skill/lib/index.js'), load('packages/core/scope/lib/index.js'),
    load('packages/core/tools/lib/index.js'), load('packages/core/system-prompt/lib/index.js'),
    load('packages/core/tool-executor-native/lib/index.js'), load('packages/skill/tool-skill/lib/index.js'),
    load('packages/core/session/lib/index.js'), load('packages/llm/llm/lib/index.js'), load('packages/core/tools/lib/pipeline.js'),
  ]);
  return { cordis, skills, scope, tools, prompt, native, loader, session, llm, pipeline };
})() : null;
const real = (name, callback) => test(name, { skip: !available && 'Build the public DSH reference SDK, or set DSH_REFERENCE_ROOT, for this integration test.' }, callback);
const summary = { name: 'packaged-skill', description: 'Packaged fixture', source: 'bundled', provider: 'supplier',
  invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'opaque', description: 'Fixture resources' } };
const signal = () => new AbortController().signal;

async function fixture(t, config = {}) {
  const { Context } = sdk.cordis, ctx = new Context(), agents = [], scopeOwners = [];
  const workingDirectory = { get: session => session.header.cwd, ensure: async agent => agent.cwd ?? agent.session.header.cwd };
  ctx.provide('workingDirectory', workingDirectory);
  ctx.provide('agents', { list: () => [...agents], get: id => agents.find(agent => agent.id === id) });
  await ctx.plugin(sdk.prompt.default);
  await ctx.plugin(sdk.tools.default);
  await ctx.plugin(sdk.native);
  await ctx.plugin(sdk.skills.default);
  await ctx.plugin(sdk.loader);
  let denied = [], runtime, manager;
  manager = ctx.plugin(Object.assign(function policyOwner(owner) {
    runtime = createInvocationPolicyRuntime({ ctx: owner, disabled: () => denied, config: { policySyncTimeoutMs: 250, policyMaxAgents: 20, ...config } });
    runtime.attach();
  }, { inject: ['skills', 'tools', 'agents', 'workingDirectory'] }));
  await manager;
  async function agent(id = `fixture-${agents.length}`) {
    const value = { id, cwd: '/fixture/workspace', session: sdk.session.Session.create(sdk.session.SessionId(id), [], {
      version: sdk.session.SESSION_FORMAT_VERSION, id: sdk.session.SessionId(id), createdAt: 0, cwd: '/fixture/workspace', isSeeded: false,
    }) };
    let scope;
    const owner = ctx.plugin(Object.assign(function fixtureAgent(owner) { scope = sdk.scope.createScope(owner, value); }, { inject: ['skills', 'tools', 'workingDirectory', 'agents'] }));
    await owner; scopeOwners.push(owner); value.ctx = scope.ctx; agents.push(value);
    return value;
  }
  let reads = 0;
  function provider(context, entries = [summary], rank = 600) {
    return context.get('skills').registerProvider(() => ({
      name: entries[0].provider,
      list: async () => entries.map(value => ({ ...value, rank, locator: value })),
      get: async candidate => { reads++; return { ...candidate.locator, content: 'SUPPLIER BODY MUST NOT BE READ WHEN DISABLED' }; },
    }));
  }
  async function step(value, text = '/packaged-skill') {
    const messages = [sdk.llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })];
    return ctx.waterfall(sdk.scope.scopeTarget(value, value), 'agent/pre-step',
      { agent: value, messages, signal: signal(), turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' } },
      async () => ({ kind: 'enter', messages }));
  }
  async function native(value) {
    const result = await ctx.tools.execute({ agent: value, signal: signal(), calls: [{ id: sdk.llm.ToolCallId('native-call'), name: 'skill', arguments: '{"name":"packaged-skill"}' }] });
    return result.results[0].result;
  }
  t.after(async () => { await runtime.dispose(); for (const owner of scopeOwners) await owner.dispose(); await manager.dispose(); await ctx.fiber.dispose(); });
  return { ctx, runtime, manager, agent, agents, provider, step, native, reads: () => reads, setDenied: value => { denied = value; }, workingDirectory };
}

test('normalization leaves every unowned or forged provider summary unchanged', async () => {
  const runtime = createInvocationPolicyRuntime({ ctx: { get: () => null }, disabled: () => [] });
  assert.equal(runtime.supported, false);
  assert.equal(runtime.normalizeSummary(summary), summary);
  const unowned = { ...summary, provider: 'pnpwin-skill-policy-forged', invocation: { modelInvocable: false, userInvocable: false } };
  assert.equal(runtime.normalizeSummary(unowned), unowned);
  await runtime.dispose();
});

test('zero overrides do no agent/cwd work even on unsupported SDK, but persisted restrictions fail closed', async () => {
  const hooks = new Map(); let denied = [], nextCalls = 0;
  const ctx = { get: () => undefined, on(name, listener) { hooks.set(name, listener); return () => hooks.delete(name); }, effect: () => () => {} };
  const runtime = createInvocationPolicyRuntime({ ctx, disabled: () => denied }); runtime.attach();
  const agent = { ctx: { plugin() { throw Error('unused policy must not create agent fibers'); } } };
  await runtime.sync(agent);
  await hooks.get('agent/pre-step')({ agent, signal: signal() }, async () => { nextCalls++; return { kind: 'enter', messages: [] }; });
  assert.equal(nextCalls, 1); assert.equal(runtime.supported, false);
  denied = [summary];
  await assert.rejects(hooks.get('agent/pre-step')({ agent, signal: signal() }, async () => { nextCalls++; }), error => error.code === 'policy-unavailable');
  assert.equal(nextCalls, 1); await runtime.dispose();
});

real('real SkillRegistry exact-agent provider disables native loader and user injection without reading supplier body', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(agent.ctx);
  f.setDenied([summary]); await f.runtime.sync(agent);
  const effective = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.notEqual(effective.provider, summary.provider);
  assert.deepEqual(effective.invocation, { modelInvocable: false, userInvocable: false });
  assert.equal(skillId(f.runtime.normalizeSummary(effective)), skillId(summary));
  assert.equal((await f.native(agent)).isError, true);
  const decision = await f.step(agent);
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.some(message => message.source.kind === 'skill-invocation'), false);
  assert.equal(f.reads(), 0);
});

real('existing exact-agent runtime contribution is suppressed, and enabling restores supplier policy/content', async t => {
  const f = await fixture(t), agent = await f.agent();
  agent.ctx.skills.register({ ...summary, provider: 'runtime-supplier', invocation: { modelInvocable: false, userInvocable: true }, content: 'original runtime instructions' });
  const original = { ...summary, provider: 'runtime-supplier', invocation: { modelInvocable: false, userInvocable: true } };
  f.setDenied([original]); await f.runtime.sync(agent);
  assert.equal((await f.step(agent)).messages.some(message => message.source.kind === 'skill-invocation'), false);
  f.setDenied([]); await f.runtime.sync();
  const restored = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.deepEqual(restored.invocation, original.invocation);
  assert.equal(restored.provider, original.provider);
  const decision = await f.step(agent);
  assert.ok(decision.messages.some(message => message.source.kind === 'skill-invocation'));
  assert.equal((await f.native(agent)).isError, true);
});

real('nested PTC shared execution pipeline obeys the exact same agent guard without loading body', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(agent.ctx); f.setDenied([summary]); await f.runtime.sync(agent);
  const pipeline = new sdk.pipeline.ToolExecutionPipeline(f.ctx);
  const prepared = await pipeline.prepare({ agent, callId: sdk.llm.ToolCallId('ptc-subcall'), parent: Symbol('ptc-parent'), rootCallId: sdk.llm.ToolCallId('ptc-root'),
    name: 'skill', arguments: { name: summary.name }, signal: signal() });
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
  const result = await pipeline.complete(prepared.exec, outcome);
  assert.equal(result.isError, true); assert.equal(f.reads(), 0);
});

real('a newly higher-priority project instance with the same name is not disabled on resynchronization', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(f.ctx); f.setDenied([summary]); await f.runtime.sync(agent);
  const project = { ...summary, provider: 'filesystem', source: 'project-dsh', path: '/fixture/workspace/.dsh/skills/packaged-skill/SKILL.md' };
  f.provider(agent.ctx, [project], 100);
  const decision = await f.step(agent);
  assert.ok(decision.messages.some(message => message.source.kind === 'skill-invocation'));
  const effective = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.equal(effective.provider, 'filesystem'); assert.equal(skillId(effective), skillId(project));
});

real('per-instance provider rules do not block a different provider/name collision in another agent', async t => {
  const f = await fixture(t), one = await f.agent('one'), two = await f.agent('two');
  f.provider(one.ctx); f.provider(two.ctx, [{ ...summary, provider: 'other-supplier' }]);
  f.setDenied([summary]); await f.runtime.sync();
  assert.equal((await f.native(one)).isError, true);
  assert.equal((await f.native(two)).isError, false);
});

real('incomplete discovery and an earlier equal-minimum-rank provider fail closed before user consumer body access', async t => {
  const f = await fixture(t), agent = await f.agent();
  const dispose = agent.ctx.skills.registerProvider(() => ({ name: 'supplier', list: async () => ({ candidates: [{ ...summary, rank: 600, locator: summary }], complete: false }),
    get: async () => { throw Error('supplier body must never be requested'); } }));
  f.setDenied([summary]);
  await assert.rejects(f.step(agent), error => error.code === 'policy-unavailable');
  dispose(); f.provider(agent.ctx, [summary], -Number.MAX_VALUE);
  await assert.rejects(f.runtime.sync(agent), error => error.code === 'policy-unavailable');
  await assert.rejects(f.step(agent), error => error.code === 'policy-unavailable');
});

real('new agents synchronize through the serial creation hook and unload restores original catalogs', async t => {
  const f = await fixture(t); f.provider(f.ctx); f.setDenied([summary]);
  const agent = await f.agent();
  await f.ctx.serial(sdk.scope.scopeTarget(agent, agent), 'agent/created', { agent, source: 'startup' });
  const proxy = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.equal(f.runtime.normalizeSummary(proxy).provider, 'supplier');
  await f.runtime.dispose();
  const original = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.equal(original.provider, 'supplier'); assert.equal(original.invocation.userInvocable, true);
  assert.equal(f.runtime.normalizeSummary(proxy).provider, 'supplier');
});

real('normalization rejects unissued identity fields even under an owned policy label', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(agent.ctx); f.setDenied([summary]); await f.runtime.sync(agent);
  const proxy = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  const changed = { ...proxy, resourceBase: { kind: 'opaque', description: 'another identity' } };
  assert.equal(f.runtime.normalizeSummary(changed), changed);
  const changedFlags = { ...proxy, invocation: { modelInvocable: true, userInvocable: true } };
  assert.equal(f.runtime.normalizeSummary(changedFlags), changedFlags);
});

real('isolated preset registry changes are rediscovered through public serviceFor and bind only the exact agent layer', async t => {
  const f = await fixture(t), agent = await f.agent(), selected = new Map();
  class Presets extends sdk.cordis.Service {
    constructor(ctx) { super(ctx, 'agentPresets'); }
    serviceFor(value, name) { return name === 'skills' ? selected.get(value) : undefined; }
  }
  await f.ctx.plugin(Presets);
  const first = f.ctx.isolate('skills'), second = f.ctx.isolate('skills');
  await first.plugin(sdk.skills.default); await second.plugin(sdk.skills.default);
  f.provider(first); f.provider(second);
  selected.set(agent, first.get('skills'));
  f.setDenied([summary]); await f.runtime.sync(agent);
  const firstView = await first.skills.snapshot({ scope: agent, cwd: agent.cwd });
  assert.notEqual(firstView.skills[0].provider, 'supplier');
  assert.equal((await first.skills.snapshot({ cwd: agent.cwd })).skills[0].provider, 'supplier');
  assert.equal((await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills.length, 0);
  selected.set(agent, second.get('skills')); await f.runtime.sync(agent);
  assert.equal((await first.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0].provider, 'supplier');
  assert.notEqual((await second.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0].provider, 'supplier');
});

real('isolated preset tool pipelines still synchronize fresh winners before native dispatch', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(f.ctx);
  const isolated = f.ctx.isolate('tools'); await isolated.plugin(sdk.tools.default); await isolated.plugin(sdk.native); await isolated.plugin(sdk.loader);
  class Presets extends sdk.cordis.Service {
    constructor(ctx) { super(ctx, 'agentPresets'); }
    serviceFor(_agent, name) { return name === 'tools' ? isolated.get('tools') : undefined; }
  }
  await f.ctx.plugin(Presets);
  const removeProject = f.provider(agent.ctx, [{ ...summary, provider: 'filesystem', source: 'project-dsh', path: '/fixture/project/SKILL.md' }], 100);
  f.setDenied([summary]); await f.runtime.sync(agent);
  removeProject();
  const result = await isolated.tools.execute({ agent, signal: signal(), calls: [{ id: sdk.llm.ToolCallId('isolated-call'), name: 'skill', arguments: '{"name":"packaged-skill"}' }] });
  assert.equal(result.results[0].result.isError, true);
  assert.equal(f.reads(), 0);
});

real('manager fiber unload alone removes agent-owned provider effects and restores original policies', async t => {
  const f = await fixture(t), agent = await f.agent(); f.provider(agent.ctx); f.setDenied([summary]); await f.runtime.sync(agent);
  await f.manager.dispose();
  const restored = (await f.ctx.skills.snapshot({ scope: agent, cwd: agent.cwd })).skills[0];
  assert.equal(restored.provider, 'supplier'); assert.deepEqual(restored.invocation, summary.invocation);
});

real('an uncooperative directory provider cannot hold synchronization or disposal past the deadline', async t => {
  const f = await fixture(t, { policySyncTimeoutMs: 25 }), agent = await f.agent();
  f.provider(agent.ctx); f.setDenied([summary]); f.workingDirectory.ensure = () => new Promise(() => {});
  await assert.rejects(f.runtime.sync(agent), error => error.code === 'policy-unavailable');
  await f.runtime.dispose(); assert.equal(f.reads(), 0);
});

real('policy agent limits fail explicitly and uncooperative provider discovery is cancelled by the deadline', async t => {
  const f = await fixture(t, { policyMaxAgents: 1, policySyncTimeoutMs: 25 });
  const one = await f.agent(), two = await f.agent(); f.setDenied([summary]);
  await assert.rejects(f.runtime.sync(), error => error.code === 'policy-unavailable');
  one.ctx.skills.registerProvider(() => ({ name: 'supplier', list: () => new Promise(() => {}), get: () => new Promise(() => {}) }));
  await assert.rejects(f.runtime.sync(one), error => error.code === 'policy-unavailable');
  assert.equal(f.reads(), 0);
});
