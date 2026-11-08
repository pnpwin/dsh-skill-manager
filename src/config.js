import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

const defaults = { workspaceDirs: [], scanIntervalMs: 60000, scanTimeoutMs: 30000, debounceMs: 750, maxContexts: 256, maxFileBytes: 1048576, observationCacheSize: 4096 };
const ranges = { scanIntervalMs: [1000, 86400000], scanTimeoutMs: [100, 300000], debounceMs: [0, 60000], maxContexts: [1, 10000], maxFileBytes: [1, 16777216], observationCacheSize: [1, 100000] };
/** Validate deployment-specific fields without reading any profile configuration files. */
export function resolveConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Skill manager config must be an object');
  for (const key of Object.keys(value)) if (!Object.hasOwn(defaults, key) && key !== 'databasePath') throw new TypeError(`Unknown skill manager option: ${key}`);
  const config = { ...defaults, ...value };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) throw new TypeError(`${key} must be an integer from ${min} to ${max}`);
  if (!Array.isArray(config.workspaceDirs) || config.workspaceDirs.some(path => typeof path !== 'string' || !isAbsolute(path))) throw new TypeError('workspaceDirs must contain absolute directory paths');
  config.workspaceDirs = [...new Set(config.workspaceDirs)];
  if (config.databasePath !== undefined && (typeof config.databasePath !== 'string' || !isAbsolute(config.databasePath))) throw new TypeError('databasePath must be an absolute path');
  return config;
}
/** Profile-local plugin data; no package-directory writes, credential lookup or profile patch editing. */
export function databasePath(ctx, config) {
  if (config.databasePath) return config.databasePath;
  const profile = ctx.get('profileContext');
  const directory = profile?.dir ?? process.env.DSH_PROFILE_DIR;
  return directory ? join(directory, 'data', 'skill-manager', 'skills.sqlite') : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'data', 'skill-manager', 'skills.sqlite');
}
/** Standard Schema v1 validation accepted by Cordis, requiring no duplicate runtime dependencies. */
export const Config = { '~standard': { version: 1, vendor: 'dsh-skill-manager', validate(value) {
  try { return { value: resolveConfig(value) }; }
  catch (error) { return { issues: [{ message: error.message }] }; }
} } };
