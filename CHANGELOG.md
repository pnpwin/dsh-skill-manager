# Changelog

## 0.3.2

- Replace ambiguous file-action labels for known provider skills without an instruction path: instruction file not specified by the provider, or protected package files where package ownership is indicated.
- Preserve actual missing/archive/deletion labels and genuine unknown availability; a resource directory is never treated as proof that an instruction file exists.
- Presentation-only correction: backend fileStatus, invocation policy, allowed actions, plan guards, database and saved preferences are unchanged.
- Add POSIX/Windows package-path and provider-label regressions without filesystem mutations.

## 0.3.1

- Missing/unavailable instances no longer appear enabled or offer invocation toggles. Saved/latest-known policy is displayed separately from current availability.
- Fresh physical-presence checks at owner preparation and admission prevent a stale protected-file plan from changing policy after the instruction disappears.
- Snapshot/detail availability is reconciled against committed state, including virtual disappearance in the same refresh; stale cached assessments cannot advertise active controls.
- Archived originals remain unavailable for invocation while retaining valid restore/delete actions. History, identity and saved preferences are unchanged; reappearance restores applicable controls.
- No database migration. A full Host restart may be needed even when Plugin Manager reports applied, because Node can retain the previous module generation.

## 0.3.0

- Per-instance owner controls: enable/disable and, for safely managed local files, archive/restore/permanent delete with explicit confirmation and exact-name deletion.
- Bundled/plugin/runtime enable/disable uses a profile-local invocation deny, not edits to package files. Real public SDK coverage includes native calls, nested PTC, explicit user injection, same-layer runtime contributions, isolated presets, recomposition and unload restoration.
- No-file policy plans are explicitly distinguished from physical file/directory plans; the agent tool and Cordis API remain read/refresh-only.
- SQLite schema 3 adds durable operation/control journals with cross-Host compare-and-set ownership; canonical identity version 2, history, invocation keys and coverage remain intact.
- Same-filesystem private archive/quarantine, bounded stable fingerprints, no-overwrite restore, stale/expired plan rejection, unknown-outcome receipts, recoverable partial failures and safe unload quiescence.
- YAML 2.9.0 preserves instruction bodies/comments during invocation-policy edits. Known owner writes are attributed only after exact revision evidence.
- New Russian management and upgrade guides. Existing images remain clearly disclosed generated catalog previews, not screenshots of the new controls.

## 0.2.2

- Remove the automatic `prepack` lifecycle hook so pnpm can install the native ESM package directly from a GitHub tag without Git dependency preparation/build approval.
- Keep validation explicit in `npm run release:check` before publication; no install/prepare lifecycle scripts or runtime compilation are needed.
- No runtime, database or API changes from 0.2.1. Existing configuration, history and credential bindings remain unchanged.

## 0.2.1

- Public GitHub distribution, repository metadata and version-pinned Plugin Manager installation instructions.
- Russian step-by-step usage guide and two explicitly labeled generated demo previews based on curated, anonymized public-skill examples; these are not captured screenshots or browser verification.
- Reproducible optional preview generator and its sanitized fixture under `src/docs/`; no implementation added at package root.
- Stronger build gate rejects root executable files and scratch artifacts while preserving existing test/resource directories.
- No database/schema/API change from 0.2.0; configuration, stored history and invocation keys remain unchanged.

## 0.2.0

- Scope-independent virtual skill identity and atomic SQLite v1→v2 migration preserving history, invocation keys, memberships and legacy-ID aliases.
- Exact-name catalog groups, expandable instances, full-group counts under filtering, and positive current-hash evidence for identical copies.
- Separate scope availability and metadata, with unique-name versus canonical-instance counters.

## 0.1.1

- Bounded refresh deadlines with late-result discard, guarded identity attribution and correct unknown hashes for unhashable revisions.

## 0.1.0

- Initial observed lifecycle, skill inventory, usage windows, full-screen Client and read/refresh API v1.
