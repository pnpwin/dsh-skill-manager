import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Canonical known resource-base fields; key insertion order and scope are not identity. */
export function canonicalResourceBase(base) {
  if (base == null) return null;
  if (base.kind === 'directory' && typeof base.path === 'string' && base.path.length) return { kind: 'directory', path: resolve(base.path) };
  if (base.kind === 'url' && typeof base.url === 'string') return { kind: 'url', url: base.url };
  if (base.kind === 'opaque' && typeof base.description === 'string') return { kind: 'opaque', description: base.description };
  throw new TypeError('Unsupported skill resource base');
}
/** Scope-independent instance identity. File IDs retain the v1 formula; unresolved names stay separate. */
export function skillId(skill) {
  const location = skill.path ? ['file', resolve(skill.path)]
    : [skill.source === 'unknown' ? 'unresolved' : 'virtual', canonicalResourceBase(skill.resourceBase)];
  return createHash('sha256').update(JSON.stringify([skill.provider, skill.name, location])).digest('hex');
}
