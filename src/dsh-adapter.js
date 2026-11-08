/** Public DSH registry and observation adapter; never reads stored conversations. */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

const contextId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const iso = time => new Date(time).toISOString()

/** Build one adapter owned by the mounting plugin. Optional services use ctx.get. */
export function createDshAdapter(ctx, config = {}, { normalizeSummary = value => value } = {}) {
  const cacheLimit = config.observationCacheSize ?? 4096
  const maxContexts = config.maxContexts ?? 256
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 1) throw new TypeError('observationCacheSize must be a positive safe integer')
  if (!Number.isSafeInteger(maxContexts) || maxContexts < 1) throw new TypeError('maxContexts must be a positive safe integer')
  const service = name => ctx.get(name)
  const warn = error => ctx.logger?.warn(`skill-manager observer: ${String(error)}`)
  function contain(callback, payload) {
    try {
      const returned = callback?.(payload)
      if (returned && typeof returned.then === 'function') void returned.catch(warn)
    } catch (error) { warn(error) }
  }

  async function discover({ signal } = {}) {
    const contexts = [], observations = [], warnings = []
    const addWarning = (code, message) => warnings.push({ code, message })
    const check = () => signal?.throwIfAborted()
    const skills = service('skills')
    if (!skills) return { contexts, observations, warnings: [{ code: 'registry-unavailable', message: 'The DSH skill registry is unavailable.' }] }
    const agents = service('agents')?.list() ?? []
    const workingDirectory = service('workingDirectory')
    const presets = service('agentPresets')
    const directories = new Map()
    const addDirectory = (cwd, label) => { if (text(cwd) && isAbsolute(cwd) && !directories.has(cwd)) directories.set(cwd, label) }
    for (const cwd of config.workspaceDirs ?? []) addDirectory(cwd, cwd)
    // Metadata-only entity reads; do not touch Workspace.sessionIds or Session logs.
    for (const workspace of service('workspaceRegistry')?.list() ?? []) addDirectory(workspace.path, workspace.title)
    addDirectory(workingDirectory?.defaultDirectory, 'Default workspace')
    for (const agent of agents) addDirectory(workingDirectory?.get(agent.session) ?? agent.session.header.cwd, 'Active workspace')
    const workspaces = directories.size > 0 ? [...directories] : [[undefined, 'No workspace']]
    let limitReported = false
    async function observe({ kind, key, label, cwd, registry = skills, scope }) {
      check()
      if (contexts.length >= maxContexts) {
        if (!limitReported) addWarning('context-limit', `Inventory is limited to ${maxContexts} contexts; narrow workspaceDirs or raise maxContexts.`)
        limitReported = true
        return
      }
      const id = contextId(kind, key, cwd ?? null)
      contexts.push({ id, label, cwd: cwd ?? null })
      try {
        const snapshot = await registry.snapshot({ cwd, scope, signal })
        check()
        observations.push({ contextId: id, skills: snapshot.skills.map(skill => normalizeSummary(skill)), complete: snapshot.complete })
        if (!snapshot.complete) addWarning('discovery-incomplete', `Skill discovery is incomplete for ${label}; absent entries are not confirmed missing.`)
      } catch (error) {
        check()
        observations.push({ contextId: id, skills: [], complete: false })
        addWarning('discovery-failed', `${label}: ${String(error)}`)
      }
    }
    // Active scopes are authoritative for retained older preset revisions and own overrides.
    for (const agent of agents) {
      const cwd = workingDirectory?.get(agent.session) ?? agent.session.header.cwd
      await observe({ kind: 'agent', key: String(agent.id), label: `Active session ${agent.id}`, cwd,
        registry: presets?.serviceFor(agent, 'skills') ?? skills, scope: agent })
    }
    for (const [cwd, label] of workspaces) await observe({ kind: 'global', key: 'host', label: `Host · ${label}`, cwd })
    if (presets) {
      let roster
      try { roster = await presets.list() } catch (error) { check(); addWarning('preset-list-failed', String(error)); roster = [] }
      for (const preset of roster) {
        check()
        if (preset.broken) { addWarning('preset-unavailable', `${preset.id}: ${preset.broken}`); continue }
        if (contexts.length >= maxContexts) {
          if (!limitReported) addWarning('context-limit', `Inventory is limited to ${maxContexts} contexts; narrow workspaceDirs or raise maxContexts.`)
          break
        }
        let lease
        try {
          lease = await presets.acquireScope(preset.id)
          check()
          for (const [cwd, label] of workspaces) await observe({ kind: 'preset', key: preset.id, label: `${preset.name ?? preset.id} · ${label}`, cwd, scope: lease.key })
        } catch (error) { check(); addWarning('preset-unavailable', `${preset.id}: ${String(error)}`) }
        finally { if (lease) await lease[Symbol.asyncDispose]() }
      }
    }
    check()
    return { contexts, observations, warnings }
  }

  function attach(callbacks = {}) {
    let active = true
    const disposers = []
    const seen = new Map(), calls = new Map()
    function retain(map, key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > cacheLimit) map.delete(map.keys().next().value)
    }
    function once(event) {
      if (!active || seen.has(event.eventKey)) return
      retain(seen, event.eventKey, true)
      contain(callbacks.invocation, event)
    }
    function actorFor(sessionId, kind = 'agent') {
      return { kind, ...(kind === 'agent' ? { id: String(sessionId) } : {}), sessionId: String(sessionId), label: kind === 'user' ? 'User invocation' : `Agent ${sessionId}` }
    }
    function callKey(sessionId, callId) { return `skill:${sessionId}:${callId}` }
    function argumentsOf(value) {
      if (typeof value === 'string') { try { return JSON.parse(value) } catch { return null } }
      return value
    }
    function invocation(sessionId, callId, args, outcome, channel, at, extra = {}) {
      const parsed = argumentsOf(args)
      if (!object(parsed) || !text(parsed.name)) return
      const live = service('agents')?.get(sessionId)
      const cwd = live === undefined ? undefined : service('workingDirectory')?.get(live.session) ?? live.session.header.cwd
      once({ eventKey: callKey(sessionId, callId), name: parsed.name, at, actor: actorFor(sessionId), outcome, channel,
        ...(live === undefined ? {} : { contextId: contextId('agent', String(live.id), cwd ?? null) }), ...extra })
    }
    function on(name, callback) {
      disposers.push(ctx.on(name, (...args) => {
        if (!active) return
        try { callback(...args) } catch (error) { warn(error) }
      }))
    }
    on('tools/result', (exec, result) => {
      if (exec.name !== 'skill' || !exec.agent) return
      const extra = {}
      if (!result.isError && object(result.value)) {
        if (text(result.value.provider)) extra.provider = result.value.provider
        const base = result.value.resourceBase
        if (object(base)) {
          if (base.kind === 'directory' && text(base.path)) extra.resourceBase = { kind: 'directory', path: base.path }
          else if (base.kind === 'url' && text(base.url)) extra.resourceBase = { kind: 'url', url: base.url }
          else if (base.kind === 'opaque' && text(base.description)) extra.resourceBase = { kind: 'opaque', description: base.description }
        }
        // The skill tool intentionally omits the instruction path from its output;
        // directory resourceBase is not necessarily a SKILL.md (flat files exist).
        if (text(result.value.path)) extra.path = result.value.path
      }
      invocation(exec.agent.session.id, exec.callId, exec.arguments, result.isError ? 'error' : 'success', exec.parent === undefined ? 'tool' : 'ptc', iso(Date.now()), extra)
    })
    on('session/event', (session, event) => {
      const { data } = event
      if (event.type === 'tool/call' && data.name === 'skill') {
        retain(calls, callKey(session.id, data.callId), data.arguments)
      } else if (event.type === 'tool/result' && event.surfaceOp === 'append') {
        const key = callKey(session.id, data.message.source.callId)
        const args = calls.get(key)
        calls.delete(key)
        if (args !== undefined) invocation(session.id, data.message.source.callId, args, data.message.isError ? 'error' : 'success', 'tool', iso(event.time))
      } else if (event.type === 'tool/ptc-dispatch' && data.name === 'skill') {
        invocation(session.id, data.subCallId, data.arguments, data.isError ? 'error' : 'success', 'ptc', iso(event.time))
      } else if (event.type === 'user/message' && event.surfaceOp === 'append' && data.source.kind === 'skill-invocation') {
        const source = data.source
        const live = service('agents')?.get(session.id)
        const cwd = live === undefined ? undefined : service('workingDirectory')?.get(session) ?? session.header.cwd
        if (text(source.name)) once({ eventKey: `skill:${session.id}:seq:${event.seq}`, name: source.name,
          at: iso(event.time), actor: actorFor(session.id, 'user'), outcome: 'success', channel: 'user',
          ...(live === undefined ? {} : { contextId: contextId('agent', String(live.id), cwd ?? null) }) })
      }
      if (event.type === 'working-directory/change' || event.type === 'agent-preset/selected') contain(callbacks.changed)
    })
    on('fs/observed', (target, observation, actor) => {
      if (!object(actor) || !['write', 'edit', 'apply_patch'].includes(actor.name) || !actor.agent?.session || !text(target.displayPath)) return
      const sessionId = actor.agent.session.id
      const eventKey = `mutation:${sessionId}:${actor.callId}:${target.displayPath}:${observation.kind}:${observation.version ?? ''}`
      if (seen.has(eventKey)) return
      retain(seen, eventKey, true)
      contain(callbacks.mutation, { eventKey, path: target.displayPath, at: iso(Date.now()), actor: actorFor(sessionId),
        observation: { kind: observation.kind, ...(observation.version === undefined ? {} : { version: observation.version }) } })
      contain(callbacks.changed)
    })
    for (const name of ['skills/change', 'agent/created', 'agent/disposed', 'loader/config-update']) on(name, () => contain(callbacks.changed))
    const dispose = () => {
      if (!active) return
      active = false
      for (const disposer of disposers.reverse()) disposer()
      seen.clear(); calls.clear()
    }
    // Register exact teardown with the mounting fiber, while also allowing early stop.
    ctx.effect(() => dispose, 'skill-manager observations')
    return dispose
  }

  return { discover, attach }
}
