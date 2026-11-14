---
title: Add a local Cargo registry to the test harness
status: done
type: task
parent: nxr-6q2chq
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:04Z
closed_at: 2026-11-14T17:42:28Z
---

Goal: end-to-end tests can version against and publish to a registry without reaching crates.io or any other real registry.

`VER-RELEASE` (`nx-rust/docs/verification.mara.md`) needs it. `EVD-CARGO-PUBLISH` (`nx-rust/docs/decisions.mara.md`) shows the setup: a private Cargo home whose `config.toml` replaces crates.io with the local registry (`[source.crates-io] replace-with`) and names it in `registry.default`, so that `cargo publish` needs no `--registry`. Without `registry.default`, cargo refuses to publish to a replaced crates.io.

- [x] A sparse registry that the harness starts and stops: `config.json`, the index, downloads, and the publish endpoint that `cargo publish` uploads to
- [x] A Cargo home per test that replaces crates.io with it, names it in `registry.default` and holds a token for it
- [x] Seeding: put a crate version into the index (with its `.crate` file where a test builds it), for the "newer version available" and "version already exists" cases
- [x] A setting that delays when the index shows an upload, longer than cargo's 60-second wait, for the timeout case of `VER-RELEASE`
- [x] The registry's files and the Cargo home are removed after each test; nothing lands in `/tmp`

Done when: a harness test publishes two dependent crates with one `cargo publish -p a -p b` on cargo 1.91 and the latest stable and reads both versions back from the index, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `SparseRegistry` (`nx-rust/test/harness/sparse-registry.ts`, exported from the harness index that the unit and end-to-end tests import) starts the server `nx-rust/test/harness/registry-server.mts` in a Node process of its own on 127.0.0.1, port picked by the system: `config.json`, the sparse index, downloads and `PUT /api/v1/crates/new` in cargo's upload format, logs of requests and uploads, and `stop()` and `remove()`. Its folder and Cargo home lie in the test run's folder. Node runs the `.mts` without its types; `nx-rust/tsconfig.spec.json` includes `test/**/*.mts`, so `typecheck` checks it, and both `typecheck` targets list `.mts` inputs.
- The Cargo home names the registry `nx-rust-test`, replaces crates.io with it, makes it `registry.default`, holds its token and makes it the HTTP proxy, which refuses every other host: `cargo publish --registry crates-io` does not follow source replacement, measured on 1.91.0 and 1.100.0. `env()` drops the shell's variables that would override the Cargo home, `no_proxy` among them, which made cargo bypass the proxy.
- `seed(crate, { crateFile })` with and without a `.crate` file (packaging shared with `LocalRegistry`); refusal of an existing version with 400 and crates.io's message, of another token with 403; `indexDelay` and `setIndexDelay()`, `Infinity` for never; `shortPublishTimeout(seconds)` for cargo's timeout in seconds, through its unstable `publish.timeout` with `RUSTC_BOOTSTRAP=1`, verified on both versions. A test that has to show the 60 seconds of an unchanged cargo takes them in a test file of its own.
- Measurements recorded in `EVD-CARGO-PUBLISH`; `VER-RELEASE` names the proxy; `nx-rust/test/README.md` describes the helper.
- `nx-rust/test/sparse-registry.spec.ts`, 17 tests in about 8 seconds, with the default toolchain (1.100.0 here) and 1.91.0 through `RUSTUP_TOOLCHAIN`, among them one `cargo publish -p rega -p regb` of two dependent crates read back from the index and by `cargo info`. Each test was seen failing with a deliberate break (15 breaks, listed in the squash message).

Checks, on the branch merged with the local `main` at 45e0038: `pnpm nx run-many -t build lint test` (38 suites, 1171 tests passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (26 tests, default toolchain), `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`, all passing.

## Review fixes

- A `.cargo/config.toml` above the working folder takes precedence over the Cargo home; one with `[http] proxy = ""` let cargo reach another host. `env()` now pins, with environment variables, the proxy, `net.offline`, `registry.default`, the registry's index, token and credential provider. Cargo takes no source replacement from the environment, so that one stays in the Cargo home; its requests still go through the proxy.
- Git and SSH transports went around the HTTP proxy. `env()` now makes cargo fetch with the git command line (`CARGO_NET_GIT_FETCH_WITH_CLI=true`) and allows git only local files (`GIT_ALLOW_PROTOCOL=file`); `file://` git dependencies still resolve.
- The server logs each request before it answers, so the log is complete once cargo exits.
- Two tests per toolchain aim cargo at a listener of their own on the loopback interface, through a configuration file above the working folder and through `git://`, `ssh://` and `https://` git URLs, and pass only if it saw no connection; each pin was dropped once to see a test fail. Measurements in `EVD-CARGO-PUBLISH`, setup in `VER-RELEASE`, pins and the guarantee in `nx-rust/test/README.md`.
