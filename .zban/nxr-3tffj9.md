---
title: The test harness's cargo wrapper starts Node for every cargo call
status: todo
type: task
tags:
  - tests
discovered_from: nxr-28k2vk
created_at: 2026-11-14T13:35:25Z
---

Goal: the cargo wrapper of the test harness (`nx-rust/test/harness/cargo-wrapper.ts`, `log-cargo.cjs`) logs each cargo call without starting Node first, so that a unit run no longer spends about 17 ms of Node start-up on each of its cargo calls, and every check of the wrapper keeps passing.

Context: found by the spike nxr-28k2vk on 14 November 2026 (`EVD-NX-24-PROCESS-STATE`, "Where the time of the unit tests goes"). The `cargo` that the harness puts first on `PATH` is a shell script that `exec`s `node log-cargo.cjs`, which appends a JSON line and then runs the real cargo. A full unit run on `main` e8958bb started it 4680 times; a wrapped `cargo --version` took 23 ms against 4 ms for the real cargo, so the wrapper adds roughly 80 s to the 588 s that the unit run's files take summed over the Jest workers, more than a long-lived Nx session per fixture would save in the whole suite. The plugin's artifact folder input also calls cargo through it, 1179 times in that run.

`log-cargo.cjs` does more than log: it records the value of `RUSTUP_AUTO_INSTALL`, pretends to be an older Cargo with `NX_RUST_TEST_CARGO_VERSION` (`--version`, `-V`, `version`, and `cargo metadata` without `build_directory`), and holds a call for `holdCargo`. A replacement has to keep all of that, and the JSON it writes has to quote every argument exactly (`CargoWrapper.calls` parses it); the rare paths may stay in Node as long as a plain call does not start it.

- [ ] Measure a wrapped call against the real cargo, and the number of wrapped calls in a unit run, on current `main`
- [ ] Write the plain path (log and `exec` the real cargo) without Node, keeping the JSON exact for arguments with quotes, backslashes, newlines and non-ASCII text, and the rare paths in Node or equivalent
- [ ] Check `cargo-wrapper.spec.ts`, the version and hold tests and the end-to-end tests, which use the wrapper through `placeIn`
- [ ] Update `nx-rust/test/README.md` and measure the unit run before and after

Done when: the plain path starts no Node, the measurements are recorded here, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
