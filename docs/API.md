# Skill Manager API v1

Public integration is the Cordis service `skillManager`; import constants/helper/types from `@pnpwin/dsh-skill-manager/api`. This document defines v1. Minor releases may add response fields and event kinds; consumers must ignore unknown fields/kinds. Removal or meaning changes require a new API major. DSH integration changes remain inside the manager adapter, not in consumers.

## Same-process consumer

```js
import { getSkillManager } from '@pnpwin/dsh-skill-manager/api';
export const inject = ['skillManager'];
export function apply(ctx) {
  const manager = getSkillManager(ctx);
  const snapshot = manager.snapshot();
  // Do not hold a stale snapshot as a live mutable object.
  ctx.effect(() => manager.subscribe(change => {
    // change.type: inventory | invocation | mutation | management | health
    // Read fresh data here; an observer cannot veto committed data.
    const current = manager.snapshot();
    // Consumer owns its own evaluation/curation policy.
  }));
}
```

Methods:

- `snapshot(): SkillSnapshot` reads currently committed inventory and recomputes rolling windows using the current clock. It never loads skill instructions. Objects are detached from persistent state; callers cannot mutate the database by changing a response.
- `refresh(): Promise<SkillSnapshot>` coalesces concurrent scans, enumerates available scopes/workspaces and probes known instruction files. It rejects on refresh failure or deadline; the last committed inventory and explicit health warning remain readable. Late results are discarded after abort checks. An uncooperative provider retains its operation-owned scope lease until it settles; another scan fails promptly while it drains rather than stacking concurrent leases. **Do not await refresh inside a Host row's apply/init:** preset enumeration may await Host Loader settlement. Initial manager discovery is deferred until its activation returns.
- `detail(id, {offset = 0, limit = 50} = {}): SkillDetail | null` returns a skill plus newest-first events. Offset is non-negative, limit is 1–200. Null means unknown ID. Offset paging is best-effort during concurrent new events; deduplicate by event ID or restart at offset 0.
- `subscribe(listener): disposer` publishes only after storage commit. Notification `{apiVersion:1,type,at}` is immutable. Listener failures are isolated; unsubscribe is idempotent. Plugin unload disposes listeners and drains already accepted observations before closing SQLite.

The same notification is emitted through DSH `skill-manager/change` (`emit`, no veto/waterfall). Consumers should use `subscribe()` to avoid requiring a runtime import for Cordis event type declarations. No undocumented `ctx` properties, SQL access or private registry fields are part of this interface.

## Snapshot fields

```ts
{
  apiVersion: 1,
  identityVersion: 2, // scope-independent instance IDs; v1 IDs remain detail aliases
  updatedAt: string, // last successful inventory refresh, ISO UTC
  coverage: {
    since: string,  // first manager DB initialization, NOT skill creation
    mode: 'observed',
    notes: string[]
  },
  contexts: Array<{id: string, label: string, cwd: string | null}>,
  warnings: Array<{code: string, message: string}>,
  skills: SkillRecord[], // flat canonical instances, not one row per scope
  groups: SkillNameGroup[] // exact-name presentation groups
}
```

`SkillRecord` contains `id`, `name`, `description`, `provider`, `source`, `path`, `status`, `firstSeenAt`, `lastSeenAt`, `createdAt`, `createdEvidence`, `createdBy`, `modifiedAt`, `modifiedBy`, `contentHash`, `availability`, `usage` and optional `management`. Additional registry metadata may be present; consumers must not rely on undocumented extra fields. `path`, dates, actors and hash can be null. `createdEvidence` is `filesystem-birthtime` or `unknown`, never inferred original author. `contentHash` is SHA-256 of the current instruction file; retained last known hash can survive deletion or a failed read.

`status`: `present` means a positive file/virtual catalog observation; `missing` means a known path returned ENOENT/ENOTDIR; `unavailable` means a virtual entry is no longer available in any completely checked scope; `unknown` means physical state or invocation identity cannot be established. A present file can have zero effective memberships. `availability` entries contain `{contextId,cwd,effective,source?,description?,invocation?,resourceBase?}`. Per-scope metadata is retained here even when shared instance identity has one current summary; incomplete discovery preserves previous memberships, so inspect warnings before asserting current completeness.

`usage`: `{count24h,count7d,total,lastAt,lastActor}`. Rolling bounds are inclusive, elapsed 24×60×60 and 7×24×60×60 seconds; no midnight reset or DST-dependent calendar arithmetic. Failed attempts are counted; `invocation` events expose `outcome:success|error`, `channel:tool|ptc|user`. `lastActor` is `{kind:'agent'|'user'|'tool'|'unknown',label,id?,sessionId?}`. A session ID identifies the invoking agent/session, not a verified natural-person identity. Total is all recorded attempts, not a guaranteed lifetime number.

Instance IDs are SHA-256 of JSON `[provider,name,location]`. File location is `['file',normalizedAbsolutePath]`, unchanged from v1. Virtual location is `['virtual',canonicalResourceBaseOrNull]`, with **no contextId**. Resource-base fields have stable insertion order: directory `{kind,path}` (resolved absolute), url `{kind,url}`, opaque `{kind,description}`; arbitrary extra fields do not enter identity. Unresolved names with no file path use `['unresolved',canonicalResourceBaseOrNull]`, so uncertainty cannot silently merge into a catalog definition. Different scope availability alone never creates an instance. Rename/move or a different provider/resource base may create a different ID. Consumers must not derive portable logical identity from these opaque instance IDs.

Schema v1→v2 migration atomically redirects memberships/events/invocations, retains first/last observation and metadata, and adds old-ID aliases. `detail(oldId)` returns canonical current ID with combined history, so cached historical links remain usable. Existing event keys, event row IDs, actor, time, outcome and channel remain unchanged; moved history may have additive `details.identityMigration`. Migration is idempotent; unknown future versions are refused rather than reset. See [upgrade notes](upgrade-0.2.md).

`SkillNameGroup` contains `{id:name,name,instanceIds,instanceCount,description,sources,providers,statuses,status,modifiedAt,usage,identicalCopies,metadataDiffers}`. Names are only presentation grouping keys, not proof of a shared logical skill. `status` is `mixed` when members differ. `usage` sums distinct canonical member counts, with lastAt/lastActor chosen from the latest member invocation. No extra calls are created by groups. `identicalCopies` is an array of `{contentHash,instanceIds}` with at least two positively present file instances sharing a non-null hash; missing/unknown files and virtual unknown bodies are not labeled identical. `metadataDiffers` includes effective per-scope metadata variants. The UI filters instances, then shows all members and full-group counters of matching groups; it does not silently calculate a partial group subtotal.

`SkillDetail`: `{skill,events,offset,limit,total}`, where each event is `{id:number,kind,at,actor,details}`. Kinds currently include `discovered`, `modified`, `missing`, `restored`, `unknown`, `unavailable`, `mutation`, `invocation`. `discovered` is first observation, not proof of creation. `mutation` attributes an observed tool write, not necessarily the current revision; `modifiedBy` is populated only when its file version matches. Unknown kinds must still be displayed safely. Bodies, prompts and raw output are never included.

## HTTP, existing owner-authenticated DSH connection

- `GET /api/skill-manager/v1/snapshot`
- `POST /api/skill-manager/v1/refresh` (no request body)
- `GET /api/skill-manager/v1/skills?id=<sha256>&offset=0&limit=50`
- `POST /api/skill-manager/v1/manage/prepare`, JSON `{id,action}`
- `POST /api/skill-manager/v1/manage/execute`, JSON `{token,confirmationText?}`
- `GET /api/skill-manager/v1/manage/status?id=<sha256>&operationId=<opaque-id>`

These are exact `connection.fetch` routes, not a separate webserver or wildcard route. Existing Host/Origin/Peer authentication applies; owner-only access is enforced by DSH. Responses use no-store and nosniff. Success returns raw JSON. Error: `{error:{code,message}}`: 400 invalid request, 403 protected action, 404 unknown ID, 409 changed/busy/recovery state, 410 expired or consumed plan, 413 body too large, 429 plan capacity, 503 unexpected operation failure. Non-owner access is rejected by the carrier. Expected restrictions are actionable; uncontrolled runtime failure details are not returned.

## Owner management protocol (0.3)

`management` is a read-only assessment: `{eligible,mode,reasonCode,reason,workingStatus,fileStatus,allowedActions,revision}`. `mode` is `file` (supported filesystem edits) or `override` (a manager-owned invocation deny without package edits). Working status is enabled/disabled/unknown; file status is active/archived/deleted/missing/unknown. An archived record can still have core `status:missing` at its original path; the independent file badge explains the managed state. Capabilities are advisory and are revalidated at preparation/admission. Reading them is not authorization.

Prepare accepts only the canonical instance ID and one of enable/disable/archive/restore/delete, never a client-supplied path. It returns `{token,operationId,id,action,name,mode,targetKind,path,fileCount,totalBytes,confirmationText,expiresAt,warnings}`. A file plan has file/directory targetKind and a concrete absolute path. An override plan accepts only enable/disable, has policy targetKind, exactly null path, zero files/bytes and null confirmationText. Both require an explicit owner confirmation. JSON request bodies are bounded to 8192 bytes and reject unknown fields.

Execute consumes the secret token and optional exact delete-name confirmation. Success returns the public operationId and action result. It does not delete recorded usage or history. Status returns `{id,operationId,action?,status}` where status is not-started/running/succeeded/failed/recovery-required/unknown. The public operationId is not an execution capability. The token is process-local, expires, and is never stored in the database, Session or browser persistence. Unknown network/timeout outcomes must be checked, not automatically retried. A not-started receipt only proves future non-admission after the original plan has expired.

File phases and saved invocation overrides share a transactional journal with compare-and-set ownership; another Host cannot overwrite a pending operation. Schema 3 adds this journal without rewriting canonical IDs or calls. Owner frontmatter writes are attributed only when a fresh version/hash matches the exact written revision. In-progress/recovery file operations temporarily deny new skill loads for their instance. See [management/recovery](MANAGEMENT.md) and [upgrade notes](upgrade-0.3.md).

Override disable is applied to native/PTC skill loading and explicit user injection through owned exact-agent policy providers/guards. Enable removes only the manager deny, never supplier-intrinsic restrictions. Package files are not modified. The manager normalizes only proven own policy summaries back to their original provider before identity/statistics; SDK-neutral catalogs may expose the actual policy provider while it owns a deny. Already loaded instructions, arbitrary filesystem reads and previously launched scripts are not revoked.

User-channel counts observe accepted explicit skill requests; their success outcome does not certify that a later pre-step injected a body. Policy changes can reject that later loading. Native/PTC outcomes reflect their committed final tool results. None of these counts proves task success.

## Agent tool

`skill_manager`:

- `{action:'list', search?,source?,status?,offset?,limit?}` returns paginated records, total, coverage and warnings. Default limit 50; maximum 200.
- `{action:'detail',id,offset?,limit?}` calls the same detail operation.
- `{action:'refresh'}` calls the same refresh operation and returns compact inventory status, not the entire catalog: `identityVersion:2`, `total`/`instanceCount` (canonical instances) and `groupCount` (unique names). List remains instance-paginated for compatibility and adds filtered `groupCount`.

This read/refresh tool does not install skills, approve changes, execute code, modify credentials, or rewrite Session events. Filters apply to list only. Errors are explicit result objects. There is intentionally no public insert/SQL/write-author API: curator/self-improve need a separate reviewed authorship and authorization design instead of forging observation evidence.
