# Upstream and attribution

This is an independent extension for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), not a fork or an official DeepSeek plugin. The first supported API release is DSH 0.2.2-rc.1.

The plugin's implementation is original MIT-licensed code. Harness services, React and the Client module loader are supplied by DSH at runtime; their implementations are not vendored in this package. The public API and source references used for integration are recorded in [research](docs/research.md).

The runtime YAML parser is the maintained [`yaml`](https://github.com/eemeli/yaml) package, pinned at 2.9.0 and distributed separately under ISC; no install/prepare lifecycle script is needed. The package lock records its integrity. All skill mutations are owned original code under `src/`, not copied Harness filesystem implementations.

The exported SVG icon is original artwork distributed under this repository's MIT license. UI colors/layout follow the host's theme tokens and management-page conventions.

The optional documentation preview generator uses Pillow (not bundled; development/documentation use only). Generated demo illustrations use an anonymized, curated public-skill example fixture, carry an explicit disclosure, and are not captured screenshots or proof of a running-browser check. No private catalog, credential, session ID or absolute user path is included in the fixture.
