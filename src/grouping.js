/** Group distinct instances by exact name for presentation; this never merges their identities or history. */
export function groupSkillInstances(skills) {
  const byName = new Map(), seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    const members = byName.get(skill.name) ?? [];
    members.push(skill); byName.set(skill.name, members);
  }
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([name, members]) => {
    members.sort((a, b) => a.id.localeCompare(b.id));
    const usage = { count24h: 0, count7d: 0, total: 0, lastAt: null, lastActor: null };
    const sources = new Set(), providers = new Set(), statuses = new Set(), signatures = new Set(), hashes = new Map();
    let modifiedAt = null;
    for (const skill of members) {
      for (const key of ['count24h', 'count7d', 'total']) usage[key] += skill.usage[key];
      if (skill.usage.lastAt && (!usage.lastAt || skill.usage.lastAt > usage.lastAt)) {
        usage.lastAt = skill.usage.lastAt; usage.lastActor = skill.usage.lastActor;
      }
      if (skill.modifiedAt && (!modifiedAt || skill.modifiedAt > modifiedAt)) modifiedAt = skill.modifiedAt;
      providers.add(skill.provider); statuses.add(skill.status);
      const variants = [skill, ...skill.availability.filter(entry => entry.effective)];
      for (const variant of variants) {
        const source = variant.source ?? skill.source;
        sources.add(source);
        const invocation = variant.invocation ?? skill.invocation;
        signatures.add(JSON.stringify([skill.provider, source, variant.description ?? skill.description,
          invocation?.modelInvocable ?? null, invocation?.userInvocable ?? null]));
      }
      // Retained hashes of missing/unknown files do not establish identical current copies.
      if (skill.path && skill.status === 'present' && skill.contentHash) {
        const copies = hashes.get(skill.contentHash) ?? [];
        copies.push(skill.id); hashes.set(skill.contentHash, copies);
      }
    }
    const allStatuses = [...statuses].sort();
    return { id: name, name, instanceIds: members.map(skill => skill.id), instanceCount: members.length,
      description: members[0].description, sources: [...sources].sort(), providers: [...providers].sort(),
      statuses: allStatuses, status: allStatuses.length === 1 ? allStatuses[0] : 'mixed', modifiedAt, usage,
      identicalCopies: [...hashes].filter(([, ids]) => ids.length > 1).sort(([a], [b]) => a.localeCompare(b)).map(([contentHash, instanceIds]) => ({ contentHash, instanceIds })),
      metadataDiffers: signatures.size > 1 };
  });
}
