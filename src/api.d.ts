export interface SkillActor { kind: 'agent' | 'user' | 'tool' | 'unknown'; label: string; id?: string; sessionId?: string }
export interface SkillUsage { count24h: number; count7d: number; total: number; lastAt: string | null; lastActor: SkillActor | null }
export type SkillResourceBase = { kind: 'directory'; path: string } | { kind: 'url'; url: string } | { kind: 'opaque'; description: string };
export interface SkillInvocationPolicy { modelInvocable: boolean; userInvocable: boolean }
export type SkillManagementAction = 'enable' | 'disable' | 'archive' | 'restore' | 'delete';
/** Read-only assessment; changing files or granting invocation overrides requires the authenticated owner UI. */
export interface SkillManagement {
  eligible: boolean; mode?: 'file' | 'override'; reasonCode: string | null; reason: string | null;
  workingStatus: 'enabled' | 'disabled' | 'unknown'; fileStatus: 'active' | 'archived' | 'deleted' | 'missing' | 'unknown';
  allowedActions: SkillManagementAction[]; revision: string | null;
}
export interface SkillManagementPlanBase {
  token: string; operationId: string; id: string; action: SkillManagementAction; name: string;
  expiresAt: string; confirmationText: string | null; warnings: string[];
}
/** Owner-only HTTP response. The secret token must not enter agent tools, logs or durable records. */
export type SkillManagementPlan = SkillManagementPlanBase & (
  | { mode: 'file'; targetKind: 'file' | 'directory'; path: string; fileCount: number; totalBytes: number }
  | { mode: 'override'; targetKind: 'policy'; path: null; fileCount: 0; totalBytes: 0; action: 'enable' | 'disable'; confirmationText: null }
);
export interface SkillManagementReceipt {
  id: string; operationId: string; action?: SkillManagementAction;
  status: 'not-started' | 'running' | 'succeeded' | 'failed' | 'recovery-required' | 'unknown';
}
export interface SkillMembership {
  contextId: string; cwd: string | null; effective: boolean;
  source?: string; description?: string; invocation?: SkillInvocationPolicy; resourceBase?: SkillResourceBase | null;
}
export interface SkillRecord {
  id: string; name: string; description: string; provider: string; source: string; path: string | null;
  status: 'present' | 'missing' | 'unavailable' | 'unknown';
  firstSeenAt: string; lastSeenAt: string; createdAt: string | null; createdEvidence: 'filesystem-birthtime' | 'unknown';
  createdBy: SkillActor | null; modifiedAt: string | null; modifiedBy: SkillActor | null; contentHash: string | null;
  resourceBase?: SkillResourceBase | null; invocation?: SkillInvocationPolicy; management?: SkillManagement;
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
export interface SkillManagerChange { apiVersion: 1; type: 'inventory' | 'invocation' | 'mutation' | 'management' | 'health'; at: string }
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
