import test from 'node:test'
import assert from 'node:assert/strict'
import { createDshAdapter } from '../src/dsh-adapter.js'

function fixture(services = {}) {
  const listeners = new Map(), effects = [], warnings = []
  const ctx = {
    get: name => services[name],
    logger: { warn: text => warnings.push(text) },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set); set.add(listener)
      return () => set.delete(listener)
    },
    effect(register) { effects.push(register()); return () => {} },
  }
  const emit = (name, ...args) => { for (const listener of [...listeners.get(name) ?? []]) listener(...args) }
  return { ctx, emit, effects, warnings, listeners }
}
const skill = { name: 'example', provider: 'filesystem', source: 'user-dsh', path: '/skills/example/SKILL.md', description: 'Example', invocation: { modelInvocable: true, userInvocable: true } }
const agent = { id: 'session-1', session: { id: 'session-1', header: { cwd: '/project' } }, ctx: {} }
const exec = { name: 'skill', callId: 'call-1', arguments: { name: 'example' }, agent }

test('discovers global and all healthy preset scopes across metadata workspace paths, releasing leases', async () => {
  const lookups = [], released = []
  const registry = { snapshot: async options => { lookups.push(options); return { skills: options.scope ? [skill] : [], complete: true } } }
  const presets = {
    list: async () => [{ id: 'standard' }, { id: 'ptc' }, { id: 'broken', broken: 'Cannot mount' }],
    acquireScope: async id => ({ key: id, [Symbol.asyncDispose]: async () => released.push(id) }),
  }
  const { ctx } = fixture({ skills: registry, agentPresets: presets,
    workspaceRegistry: { list: () => [{ path: '/workspace', title: 'Workspace', get sessionIds() { throw Error('must not read sessions') } }] },
    workingDirectory: { defaultDirectory: '/default' } })
  const result = await createDshAdapter(ctx, { workspaceDirs: ['/configured', '/workspace'] }).discover()
  assert.equal(result.contexts.length, 9)
  assert.equal(result.observations.length, 9)
  assert.equal(lookups.filter(row => row.scope === 'standard').length, 3)
  assert.deepEqual(released, ['standard', 'ptc'])
  assert.ok(result.warnings.some(row => row.code === 'preset-unavailable'))
  assert.equal(new Set(result.contexts.map(row => row.id)).size, 9)
})

test('active agent inventory reads committed cwd and its isolated registry without ensure or log reads', async () => {
  const calls = []
  const registry = { snapshot: async options => { calls.push(options); return { skills: [skill], complete: true } } }
  const { ctx } = fixture({ skills: registry, agents: { list: () => [agent] },
    workingDirectory: { get: () => '/changed', ensure() { throw Error('ensure may write a session') } },
    agentPresets: { serviceFor: (value, name) => { assert.equal(value, agent); assert.equal(name, 'skills'); return registry }, list: async () => [] } })
  const result = await createDshAdapter(ctx).discover()
  assert.equal(calls[0].scope, agent)
  assert.equal(calls[0].cwd, '/changed')
  assert.equal(result.contexts.length, 2)
})

test('failed or incomplete contexts do not claim authoritative absence', async () => {
  const { ctx } = fixture({ skills: { snapshot: async () => { throw Error('provider unavailable') } } })
  const result = await createDshAdapter(ctx).discover()
  assert.equal(result.observations[0].complete, false)
  assert.deepEqual(result.observations[0].skills, [])
  assert.ok(result.warnings.some(row => row.code === 'discovery-failed'))
  const partial = fixture({ skills: { snapshot: async () => ({ skills: [skill], complete: false }) } })
  const observed = await createDshAdapter(partial.ctx).discover()
  assert.ok(observed.warnings.some(row => row.code === 'discovery-incomplete'))
})

test('cancellation releases preset scope even when provider observation is interrupted', async () => {
  const abort = new AbortController()
  let released = false
  const { ctx } = fixture({
    skills: { snapshot: async ({ scope }) => { if (scope) abort.abort(Error('cancelled')); return { skills: [], complete: true } } },
    agentPresets: { list: async () => [{ id: 'standard' }], acquireScope: async () => ({ key: 'preset', [Symbol.asyncDispose]: async () => { released = true } }) },
  })
  await assert.rejects(createDshAdapter(ctx).discover({ signal: abort.signal }), /cancelled/)
  assert.equal(released, true)
})

test('context bound is explicit and does not leak preset leases', async () => {
  let acquired = false
  const { ctx } = fixture({ skills: { snapshot: async () => ({ skills: [], complete: true }) },
    agentPresets: { list: async () => [{ id: 'standard' }], acquireScope: async () => { acquired = true } } })
  const result = await createDshAdapter(ctx, { maxContexts: 1 }).discover()
  assert.equal(result.contexts.length, 1)
  assert.equal(acquired, false)
  assert.ok(result.warnings.some(row => row.code === 'context-limit'))
})

test('model tool final outcome is counted once across the native committed event pair', () => {
  const f = fixture({ agents: { get: () => agent }, workingDirectory: { get: () => '/project' } }), invocations = []
  createDshAdapter(f.ctx).attach({ invocation: row => invocations.push(row) })
  f.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: 1000, data: { name: 'skill', callId: 'call-1', arguments: '{"name":"example"}' } })
  f.emit('tools/result', exec, { isError: false, value: { name: 'example', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/skills' }, content: 'private body is not captured' } })
  f.emit('session/event', agent.session, { type: 'tool/result', seq: 2, time: 1001, surfaceOp: 'append', data: { message: { source: { kind: 'tool', callId: 'call-1' }, isError: false } } })
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].provider, 'filesystem')
  assert.equal(invocations[0].outcome, 'success')
  assert.equal(invocations[0].path, undefined)
  assert.equal(invocations[0].content, undefined)
  assert.equal(invocations[0].actor.sessionId, agent.id)
  assert.match(invocations[0].contextId, /^[a-f0-9]{24}$/)
  assert.deepEqual(invocations[0].resourceBase, { kind: 'directory', path: '/skills' })
})

test('PTC final observation and durable subdispatch share a deduplication identity', () => {
  const f = fixture(), invocations = []
  createDshAdapter(f.ctx).attach({ invocation: row => invocations.push(row) })
  f.emit('tools/result', { ...exec, parent: Symbol('parent'), callId: 'sub-1' }, { isError: true })
  f.emit('session/event', agent.session, { type: 'tool/ptc-dispatch', seq: 3, time: 1002,
    data: { name: 'skill', subCallId: 'sub-1', arguments: { name: 'example' }, isError: true } })
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].channel, 'ptc')
  assert.equal(invocations[0].outcome, 'error')
})

test('durable native fallback counts synthetic results without tools/result and ignores malformed arguments', () => {
  const f = fixture(), invocations = []
  createDshAdapter(f.ctx).attach({ invocation: row => invocations.push(row) })
  for (const [callId, args] of [['valid', '{"name":"example"}'], ['bad', '{']]) {
    f.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: 1000, data: { name: 'skill', callId, arguments: args } })
    f.emit('session/event', agent.session, { type: 'tool/result', seq: 2, time: 1001, surfaceOp: 'append', data: { message: { source: { callId }, isError: true } } })
  }
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].outcome, 'error')
})

test('user invocation reads durable source only, never catalog entries or raw slash/text tags', () => {
  const f = fixture(), invocations = []
  createDshAdapter(f.ctx).attach({ invocation: row => invocations.push(row) })
  const emit = source => f.emit('session/event', agent.session, { type: 'user/message', seq: 9, time: 1700000000000, surfaceOp: 'append', data: { source, content: [{ type: 'text', text: '/example <skill_content name="example">' }] } })
  emit({ kind: 'user' })
  emit({ kind: 'skill-catalog', entries: [{ name: 'example' }] })
  emit({ kind: 'skill-invocation', name: 'example', form: 'instructions' })
  emit({ kind: 'skill-invocation', name: 'example', form: 'instructions' })
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].channel, 'user')
  assert.equal(invocations[0].actor.kind, 'user')
  assert.equal(invocations[0].at, '2023-11-14T22:13:20.000Z')
})

test('only mutation-tool observations carry known authorship; read and shell events do not', () => {
  const f = fixture(), mutations = []
  createDshAdapter(f.ctx).attach({ mutation: row => mutations.push(row) })
  for (const name of ['read', 'read_image', 'bash', 'write', 'edit', 'apply_patch']) {
    f.emit('fs/observed', { displayPath: '/skills/example/SKILL.md' }, { kind: 'present', version: name }, { ...exec, name })
  }
  f.emit('fs/observed', { displayPath: '/skills/example/SKILL.md' }, { kind: 'present', version: 'write' }, { ...exec, name: 'write' })
  assert.equal(mutations.length, 3)
  assert.ok(mutations.every(row => row.actor.kind === 'agent'))
})

test('callback errors are contained; explicit and fiber disposal remove all listeners', async () => {
  const f = fixture()
  let changed = 0
  const dispose = createDshAdapter(f.ctx).attach({ invocation: () => { throw Error('store failed') }, changed: () => { changed++ } })
  assert.doesNotThrow(() => f.emit('tools/result', exec, { isError: true }))
  assert.match(f.warnings[0], /store failed/)
  f.emit('skills/change'); assert.equal(changed, 1)
  dispose(); dispose(); f.effects[0]()
  f.emit('skills/change'); assert.equal(changed, 1)
  assert.ok([...f.listeners.values()].every(set => set.size === 0))
})

test('does not count search, direct get, or unowned tool outcomes', () => {
  const f = fixture(), invocations = []
  createDshAdapter(f.ctx).attach({ invocation: row => invocations.push(row) })
  f.emit('tools/result', { ...exec, name: 'skill_search' }, { isError: false })
  f.emit('tools/result', { ...exec, agent: undefined }, { isError: false })
  assert.equal(invocations.length, 0)
})
