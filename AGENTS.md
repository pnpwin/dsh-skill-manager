# Contributor guidance

- Keep all executable implementation under `src/`: Host/runtime, Client UI, CLI, build scripts, helpers and compatibility entries. Do not add package-root JS/TS/Python/shell files or forwarding stubs.
- Root regular files are limited to documentation (README, LICENSE, UPSTREAM and contributor guidance), Git/package/lock metadata, and files DSH genuinely needs to discover/load/display this bundle (patch and exported icon).
- Preserve existing `test/`, `tests/`, `locale/` and other test/resource directories. The source-layout requirement concerns package-root files, not moving these directories.
- Run tests, build, declaration checks and inspect packed resources before publishing. Never publish credentials, private catalogs, raw session logs, machine-specific paths, private database snapshots or node_modules.
- Manage live installations through DSH Plugin Manager. Preserve profile configuration, data and named credential bindings when replacing local source with a GitHub release.
- Generated UI previews must remain labeled as generated illustrations; never describe them as captured screenshots or evidence of live visual verification.
