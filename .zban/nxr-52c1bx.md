---
title: Add a local Cargo registry to the test harness
status: todo
type: task
parent: nxr-6q2chq
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:04Z
---

Goal: end-to-end tests can version against and publish to a registry without reaching crates.io or any other real registry.

`VER-RELEASE` (`nx-rust/docs/verification.mara.md`) needs it. `EVD-CARGO-PUBLISH` (`nx-rust/docs/decisions.mara.md`) shows the setup: a private Cargo home whose `config.toml` replaces crates.io with the local registry (`[source.crates-io] replace-with`) and names it in `registry.default`, so that `cargo publish` needs no `--registry`. Without `registry.default`, cargo refuses to publish to a replaced crates.io.

- [ ] A sparse registry that the harness starts and stops: `config.json`, the index, downloads, and the publish endpoint that `cargo publish` uploads to
- [ ] A Cargo home per test that replaces crates.io with it, names it in `registry.default` and holds a token for it
- [ ] Seeding: put a crate version into the index (with its `.crate` file where a test builds it), for the "newer version available" and "version already exists" cases
- [ ] A setting that delays when the index shows an upload, longer than cargo's 60-second wait, for the timeout case of `VER-RELEASE`
- [ ] The registry's files and the Cargo home are removed after each test; nothing lands in `/tmp`

Done when: a harness test publishes two dependent crates with one `cargo publish -p a -p b` on cargo 1.91 and the latest stable and reads both versions back from the index, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
