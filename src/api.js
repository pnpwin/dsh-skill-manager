/** Stable integration key. Consumers inject this service instead of importing implementation files. */
export const SKILL_MANAGER_SERVICE = 'skillManager';
/** Breaking changes require a new major interface version. Additive response fields are allowed. */
export const SKILL_MANAGER_API_VERSION = 1;
/** Resolve v1 or fail explicitly; never silently bind an incompatible manager. */
export function getSkillManager(ctx) {
  const service = ctx.get(SKILL_MANAGER_SERVICE);
  if (!service || service.apiVersion !== SKILL_MANAGER_API_VERSION) throw new Error('Skill manager API v1 is unavailable');
  return service;
}
