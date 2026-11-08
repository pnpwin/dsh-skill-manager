import { createDshAdapter } from './dsh-adapter.js';
import { createSkillManager } from './service.js';
import { createInvocationPolicyRuntime } from './invocation-policy.js';
import { resolveConfig, databasePath } from './config.js';
export { Config } from './config.js';

export const name = 'skill-manager';
export const inject = ['skills', 'agents', 'workingDirectory', 'tools', 'connection'];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });
async function actionBody(request, keys) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new TypeError('Action requests require application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError('A JSON action request is required');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) throw Object.assign(new Error('Action request exceeds 8192 bytes'), { status: 413, code: 'request-too-large' });
      chunks.push(Buffer.from(part.value));
    }
  } finally { try { await reader.cancel(); } catch { /* The bounded reader may already be closed. */ } }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new TypeError('Invalid JSON action request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unexpected action request fields');
  return value;
}
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
function integer(value, fallback, max) {
  if (value === null || value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new TypeError('Invalid pagination');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > max) throw new TypeError('Invalid pagination');
  return result;
}
function detail(manager, id, offset, limit) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new TypeError('A valid skill id is required');
  const count = integer(limit, 50, 200);
  if (count === 0) throw new TypeError('limit must be greater than zero');
  return manager.detail(id, { offset: integer(offset, 0, Number.MAX_SAFE_INTEGER), limit: count });
}
/** Install one Host service and owner-authenticated routes on DSH's existing connection. */
export function apply(ctx, input = {}) {
  const config = resolveConfig(input);
  let invocationRuntime;
  const adapter = createDshAdapter(ctx, config, { normalizeSummary: summary => invocationRuntime?.normalizeSummary(summary) ?? summary });
  const manager = createSkillManager({ adapter, filename: databasePath(ctx, config), config,
    invocationRuntimeFactory: options => (invocationRuntime = createInvocationPolicyRuntime({ ctx, ...options })),
    publish: event => ctx.emit('skill-manager/change', event),
  });
  ctx.effect(() => () => manager.dispose(), 'skill-manager database and timers');
  // Expose only the stable service methods, never the database handle or teardown.
  const api = Object.freeze({ apiVersion: 1, snapshot: manager.snapshot, refresh: manager.refresh, detail: manager.detail, subscribe: manager.subscribe });
  ctx.provide('skillManager', api);
  const route = (path, method, operation) => ctx.effect(() => ctx.connection.fetch.register({ path: `/api/skill-manager/v1/${path}`, methods: [method], requestBody: 'buffered',
    fetch: async request => {
      try { const value = await operation(new URL(request.url), request); return value === null ? json({ error: { code: 'not-found', message: 'Skill not found' } }, 404) : json(value); }
      catch (error) {
        const controlled = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 && typeof error.code === 'string';
        return json({ error: { code: controlled ? error.code : error instanceof TypeError ? 'invalid-request' : 'operation-failed', message: controlled || error instanceof TypeError ? error.message : 'Skill manager operation failed; check plugin status and try again.' } }, controlled ? error.status : error instanceof TypeError ? 400 : 503);
      }
    },
  }));
  route('snapshot', 'GET', () => manager.snapshot());
  route('refresh', 'POST', () => manager.refresh());
  route('skills', 'GET', url => detail(manager, url.searchParams.get('id'), url.searchParams.get('offset'), url.searchParams.get('limit')));
  // File-changing capabilities are owner-only; they are intentionally absent from the agent tool/Cordis read API.
  route('manage/prepare', 'POST', async (_url, request) => {
    const value = await actionBody(request, ['id', 'action']);
    if (!validId(value.id) || !['enable', 'disable', 'archive', 'restore', 'delete'].includes(value.action)) throw new TypeError('A valid instance id and action are required');
    return manager.prepareAction(value);
  });
  route('manage/execute', 'POST', async (_url, request) => {
    const value = await actionBody(request, ['token', 'confirmationText']);
    if (typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 512 || value.confirmationText !== undefined && typeof value.confirmationText !== 'string') throw new TypeError('A valid confirmation token is required');
    return manager.executeAction(value);
  });
  route('manage/status', 'GET', url => {
    if ([...url.searchParams.keys()].some(key => !['id', 'operationId'].includes(key))) throw new TypeError('Unexpected operation status fields');
    const id = url.searchParams.get('id'), operationId = url.searchParams.get('operationId');
    if (!validId(id) || typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(operationId)) throw new TypeError('A valid instance and operation id are required');
    return manager.actionStatus({ id, operationId });
  });
  ctx.effect(() => ctx.tools.register({
    name: 'skill_manager',
    description: 'Inspect skills visible to DSH presets and workspaces, observed lifecycle, and instruction-load attempts (24 hours, 7 days, all recorded). Unknown authors and pre-install history are not guessed. Read does not load skill instructions. Refresh rescans current registries and known instruction files; it does not install, edit or execute skills.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['list', 'detail', 'refresh'] },
      id: { type: 'string', description: 'Skill id returned by list; required for detail.' },
      search: { type: 'string', description: 'Case-insensitive name/description filter for list.' },
      source: { type: 'string', description: 'Exact discovery source filter for list.' },
      status: { type: 'string', enum: ['present', 'missing', 'unavailable', 'unknown'] },
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
    } },
    timeoutMs: config.scanTimeoutMs + 10000,
    isConcurrencySafe: () => true,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      try {
        if (!args || !['list', 'detail', 'refresh'].includes(args.action) || Object.keys(args).some(key => !['action', 'id', 'search', 'source', 'status', 'offset', 'limit'].includes(key))) throw new TypeError('Invalid skill_manager request');
        if (args.action === 'detail') {
          if (args.search !== undefined || args.source !== undefined || args.status !== undefined) throw new TypeError('Filters apply only to list');
          return detail(manager, args.id, args.offset, args.limit) ?? { error: { code: 'not-found', message: 'Skill not found' } };
        }
        if (args.action === 'refresh') {
          if (Object.keys(args).length !== 1) throw new TypeError('Refresh accepts action only');
          const snapshot = await manager.refresh();
          return { apiVersion: 1, identityVersion: snapshot.identityVersion, updatedAt: snapshot.updatedAt, total: snapshot.skills.length, instanceCount: snapshot.skills.length, groupCount: snapshot.groups.length, coverage: snapshot.coverage, warnings: snapshot.warnings };
        }
        if (args.id !== undefined || args.search !== undefined && typeof args.search !== 'string' || args.source !== undefined && typeof args.source !== 'string' || args.status !== undefined && !['present', 'missing', 'unavailable', 'unknown'].includes(args.status)) throw new TypeError('Invalid list filter');
        const snapshot = manager.snapshot();
        const skills = snapshot.skills.filter(skill => (!args.search || `${skill.name} ${skill.description}`.toLowerCase().includes(args.search.toLowerCase())) && (!args.source || skill.source === args.source) && (!args.status || skill.status === args.status));
        const offset = integer(args.offset, 0, Number.MAX_SAFE_INTEGER), limit = integer(args.limit, 50, 200);
        if (limit === 0) throw new TypeError('limit must be greater than zero');
        return { apiVersion: 1, identityVersion: snapshot.identityVersion, coverage: snapshot.coverage, warnings: snapshot.warnings, total: skills.length, groupCount: new Set(skills.map(skill => skill.name)).size, offset, limit, skills: skills.slice(offset, offset + limit) };
      } catch (error) { return { error: { code: error instanceof TypeError ? 'invalid-request' : 'operation-failed', message: error instanceof TypeError ? error.message : 'Skill manager operation failed; check storage and plugin status.' } }; }
    },
  }));
  // Preset enumeration waits for Host Loader settlement. Never await it in this row's apply.
  ctx.effect(() => {
    const start = setImmediate(() => { void manager.refresh().catch(() => {}); });
    return () => clearImmediate(start);
  }, 'skill-manager initial discovery after activation');
}
