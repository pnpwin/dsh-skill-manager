# 0.2.0: scope-independent identity and grouped catalog

## What changes

0.1.x included `contextId` in virtual instance IDs. Agent creation, preset views and workspace/scope combinations could therefore multiply a single provider definition into hundreds of rows. 0.2.0 removes context identity from the hash, keeps availability separately, and groups the catalog by exact skill name.

- File instance ID: SHA-256 of JSON `[provider,name,['file',normalizedAbsolutePath]]`, unchanged.
- Virtual instance ID: SHA-256 of JSON `[provider,name,['virtual',canonicalResourceBaseOrNull]]`.
- Unresolved invocation with no known file: separate `unresolved` location marker; no false merge into known definitions.
- Scope stores metadata and effective membership, not another instance. Provider/name/resource base still distinguish genuinely separate virtual instances; a provider that omits a stable resource base cannot expose a finer portable identity through the public registry.
- UI counters distinguish unique names and canonical instances. Groups expand to all instances with sources, path/base, metadata, status and per-instance counts. Filtering retains the whole matching group and its full counts. Only equal known hashes of current present files receive an identical-content label.

## Database migration

The first 0.2.0 database open upgrades `PRAGMA user_version=1` to `2` in one `BEGIN IMMEDIATE` transaction. It inserts canonical targets before moving foreign keys, unions availability (effective true wins a collision), keeps each scope's catalog metadata, preserves earliest firstSeenAt and latest lastSeenAt, redirects events/invocations and removes superseded instance rows. Invocation `event_key` stays the permanent dedup key; histories are not summed from cached counters. Non-invocation events from multiple original observations remain in the combined timeline, rather than being silently discarded.

Old IDs remain in `skill_aliases`; detail lookup resolves them to current canonical rows. Moved event details gain `identityMigration` with previous ID and identity version. Original event IDs/keys, actor/time/outcome/channel, coverage start and other plugin metadata remain intact. Foreign-key validation precedes commit. A failure rolls back migration, including aliases table and version changes; it never deletes/reinitializes the database. Reopening v2 does not remigrate. Future schema versions fail explicitly.

## Applying the update

For a linked workspace installation, fully restart DSH to load the new Host modules and Client together. A page refresh alone cannot replace cached Host JavaScript or run its database migration. Do not delete the existing database, remove the profile or reinstall other plugins. Existing configuration and credential bindings are untouched. Installed package management stays in Plugin Manager; no profile metadata is hand-edited.

Stop old plugin processes before migrating: simultaneous v1 and v2 writers are unsupported. Before an intentional downgrade, make a consistent SQLite backup while the old plugin is stopped (or use the SQLite backup facility). 0.1.x cannot open schema v2; downgrade requires the original v1 backup, not editing user_version backwards.

## Checks

Regression tests use independently seeded v1 SQLite fixtures and real reopen cycles. They check every virtual resource-base kind, unchanged file IDs, aliases, exact call metadata, all history rows, scope churn, membership metadata, idempotence and atomic rollback on malformed legacy JSON. Grouping/client pure-projection tests cover combined filters, full-group counters, distinct source instances, current-hash evidence, and preservation of input data. These checks are not a rendered-browser claim.
