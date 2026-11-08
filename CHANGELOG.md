# Changelog

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
