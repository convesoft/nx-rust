---
title: Set up fixture workspaces and the graph and cache-key test harness
status: done
type: feature
priority: high
tags:
  - tests
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T08:51:41Z
---

Goal: the test infrastructure that every later feature of the plugin is checked with.

Described under "How the plugin is tested" in `nx-rust/docs/verification.mara.md`. Used first by `VER-GRAPH` and `VER-CACHE-KEYS`.

Since nxr-qvgptg the end-to-end test project is written by hand in `createTestProject` (`nx-rust-e2e/src/nx-rust.spec.ts`), without `create-nx-workspace`: an empty Nx workspace with the Nx version of this repository, in `nx-rust-e2e/tmp/test-project`. Build on that helper. It runs no git command and the test project is not a git repository, so a test that needs git has to create one inside the test project first.

- [x] Fixture Cargo workspaces under version control: a workspace in a subfolder, two workspaces, a standalone crate, an excluded member, a path dependency across workspaces, a vendored crate that is excluded and used by path, a name collision, a dev-dependency cycle, workspaces with different toolchains
- [x] A helper that loads a fixture through the plugin and returns the project graph for comparison
- [x] A cache-key matrix runner: pairs of states with the verdict "must differ" or "must not differ", hashed with the real Nx hasher
- [x] The end-to-end project installs a fixture next to the plugin, and a cargo wrapper logs invocations

Done when: one trivial graph test, one matrix row and one end-to-end test run against a fixture, in `pnpm nx run-many -t test` and `pnpm nx e2e nx-rust-e2e`.

## Summary of Changes

- Nine fixture repositories in `nx-rust/test/fixtures`, one per situation of the list above, each Cargo workspace with a current `Cargo.lock`. Every workspace built and passed `cargo test --offline --locked` (the pinned one on 1.91.0). `nx-rust/test/fixtures.spec.ts` checks each fixture's workspaces and members against `cargo metadata --offline --locked`.
- Harness in `nx-rust/test/harness`, documented in `nx-rust/test/README.md`: `loadFixtureGraph` and `FixtureWorkspace` copy a fixture to a temporary folder and run Nx's own graph creation there with the plugin loaded from `src/index.ts`; `describeCacheKeyMatrix` and `compareCacheKeys` hash tasks in two states with Nx's task hasher, along the path `nx run` takes, and name the inputs whose hash changed; `CargoWrapper` logs each cargo invocation (folder and arguments), including those from Nx's plugin workers; `installFixture` puts a fixture into the end-to-end test project; `testEnvironment` drops the outer Nx run's `NX_` variables, turns the daemon off, sets `RUSTUP_AUTO_INSTALL=0` and puts rustup's folder first on `PATH`, because Nx's run-commands puts Node's folder first, where a system cargo shadowed rustup on the development machine.
- Trivial tests: `nx-rust/test/graph.spec.ts` (a fixture through the plugin, and a failed graph creation), `nx-rust/test/cache-keys.spec.ts` (two rows on a hand-written target), `nx-rust/test/cargo-wrapper.spec.ts`, and two end-to-end tests in `nx-rust-e2e/src/nx-rust.spec.ts` (a fixture next to the installed plugin, and the wrapper's log).
- CI installs toolchain 1.91.0 in the check job for the `different-toolchains` fixture; locally that fixture's checks are skipped without it.
- Mutation checks, reverted: a `createNodes` in `src/index.ts` appeared in the graph (with `vendor/**` excluded through the fixture's `nx.json`), its `cargo metadata` calls appeared in the log, and inverted verdicts failed with the changed inputs named.

Checks run: `pnpm nx run-many -t build lint test` (16 unit tests), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (3 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete, no errors or warnings), `zban check`. CI on the pull request covers the check job with the added toolchain.

Rejected: running `nx graph` through the CLI (needs `node_modules` in the copy and returns no hashes); placing the copies inside this repository; loading the built plugin from `dist` (tests would depend on `build`). Found and filed: nxr-1ydrfd (rustup installs a missing toolchain when the plugin runs cargo).
