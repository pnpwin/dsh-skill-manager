export interface SkillActor { kind: 'agent' | 'user' | 'tool' | 'unknown'; label: string; id?: string; sessionId?: string }
export interface SkillUsage { count24h: number; count7d: number; total: number; lastAt: string | null; lastActor: SkillActor | null }
export type SkillResourceBase = { kind: 'directory'; path: string } | { kind: 'url'; url: string } | { kind: 'opaque'; description: string };
export interface SkillInvocationPolicy { modelInvocable: boolean; userInvocable: boolean }
export interface SkillMembership {
  contextId: string; cwd: string | null; effective: boolean;
  source?: string; description?: string; invocation?: SkillInvocationPolicy; resourceBase?: SkillResourceBase | null;
}
export interface SkillRecord {
  id: string; name: string; description: string; provider: string; source: string; path: string | null;
  status: 'present' | 'missing' | 'unavailable' | 'unknown';
  firstSeenAt: string; lastSeenAt: string; createdAt: string | null; createdEvidence: 'filesystem-birthtime' | 'unknown';
  createdBy: SkillActor | null; modifiedAt: string | null; modifiedBy: SkillActor | null; contentHash: string | null;
  resourceBase?: SkillResourceBase | null; invocation?: SkillInvocationPolicy;
  availability: SkillMembership[];
  usage: SkillUsage;
}
export interface SkillNameGroup {
  id: string; name: string; instanceIds: string[]; instanceCount: number; description: string;
  sources: string[]; providers: string[]; statuses: SkillRecord['status'][];
  status: SkillRecord['status'] | 'mixed'; modifiedAt: string | null; usage: SkillUsage;
  identicalCopies: Array<{ contentHash: string; instanceIds: string[] }>; metadataDiffers: boolean;
}
export interface SkillSnapshot {
  apiVersion: 1; identityVersion: 2; updatedAt: string; coverage: { since: string; mode: 'observed'; notes: string[] };
  contexts: Array<{ id: string; label: string; cwd: string | null }>;
  warnings: Array<{ code: string; message: string }>; skills: SkillRecord[]; groups: SkillNameGroup[];
}
export interface SkillDetail { skill: SkillRecord; offset: number; limit: number; total: number; events: Array<{ id: number; kind: string; at: string; actor: SkillActor | null; details: Record<string, unknown> }> }
export interface SkillManagerChange { apiVersion: 1; type: 'inventory' | 'invocation' | 'mutation' | 'health'; at: string }
export interface SkillManagerV1 {
  readonly apiVersion: 1;
  snapshot(): SkillSnapshot;
  refresh(): Promise<SkillSnapshot>;
  detail(id: string, pagination?: { offset?: number; limit?: number }): SkillDetail | null;
  subscribe(listener: (event: SkillManagerChange) => void): () => void;
}
export const SKILL_MANAGER_SERVICE: 'skillManager';
export const SKILL_MANAGER_API_VERSION: 1;
export function getSkillManager(ctx: { get(name: string): unknown }): SkillManagerV1;
