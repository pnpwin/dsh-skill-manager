import { createDshAdapter } from './dsh-adapter.js';
import { createSkillManager } from './service.js';
import { resolveConfig, databasePath } from './config.js';
export { Config } from './config.js';

export const name = 'skill-manager';
export const inject = ['skills', 'agents', 'workingDirectory', 'tools', 'connection'];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });
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
  const manager = createSkillManager({ adapter: createDshAdapter(ctx, config), filename: databasePath(ctx, config), config,
    publish: event => ctx.emit('skill-manager/change', event),
  });
  ctx.effect(() => () => manager.dispose(), 'skill-manager database and timers');
  // Expose only the stable service methods, never the database handle or teardown.
  const api = Object.freeze({ apiVersion: 1, snapshot: manager.snapshot, refresh: manager.refresh, detail: manager.detail, subscribe: manager.subscribe });
  ctx.provide('skillManager', api);
  const route = (path, method, operation) => ctx.effect(() => ctx.connection.fetch.register({ path: `/api/skill-manager/v1/${path}`, methods: [method], requestBody: 'buffered',
    fetch: async request => {
      try { const value = await operation(new URL(request.url)); return value === null ? json({ error: { code: 'not-found', message: 'Skill not found' } }, 404) : json(value); }
      catch (error) { return json({ error: { code: error instanceof TypeError ? 'invalid-request' : 'operation-failed', message: error instanceof TypeError ? error.message : 'Skill manager operation failed; check plugin status and try again.' } }, error instanceof TypeError ? 400 : 503); }
    },
  }));
  route('snapshot', 'GET', () => manager.snapshot());
  route('refresh', 'POST', () => manager.refresh());
  route('skills', 'GET', url => detail(manager, url.searchParams.get('id'), url.searchParams.get('offset'), url.searchParams.get('limit')));
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
