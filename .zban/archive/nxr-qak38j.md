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
- Harness in `nx-rust/test/harness`, documented in `nx-rust/test/README.md`: `loadFixtureGraph` and `FixtureWorkspace` copy a fixture to a temporary folder and run Nx's own graph creation there with the plugin loaded from `src/index.ts`; `describeCacheKeyMatrix` and `compareCacheKeys` hash tasks in two states with Nx's task hasher, along the path `nx run` takes, and name the inputs whose hash changed; `CargoWrapper` logs each cargo invocation (folder and arguments) and runs the real cargo with its own folder first on `PATH`, so that cargo runs the matching `rustc`; it sits first on the `PATH` of the `nx` command, which graph creation (plugin workers included), executors and batches inherit, and a copy in the workspace's `node_modules/.bin` comes ahead of Node's folder on the `PATH` that `nx:run-commands` rebuilds for its tasks; `FixtureWorkspace.nx` runs Nx tasks in a copy, and a copy whose creation fails is removed; `installFixture` puts a fixture into the end-to-end test project; `testEnvironment` drops the outer Nx run's `NX_` variables, turns the daemon off, sets `RUSTUP_AUTO_INSTALL=0` and puts rustup's folder first on `PATH`, because Nx's run-commands puts Node's folder first, where a system cargo shadowed rustup on the development machine.
- Trivial tests: `nx-rust/test/graph.spec.ts` (a fixture through the plugin, and a failed graph creation), `nx-rust/test/cache-keys.spec.ts` (two rows on a hand-written target), `nx-rust/test/cargo-wrapper.spec.ts` (the wrapper alone, and cargo started by an `nx:run-commands` task, an executor and a batched executor, through a stand-in executor), `nx-rust/test/fixture-workspace.spec.ts` (no folder left after a failed creation), and five end-to-end tests in `nx-rust-e2e/src/nx-rust.spec.ts` (a fixture next to the installed plugin, the wrapper's log, and the same three ways of starting cargo).
- CI installs toolchain 1.91.0 in the check job for the `different-toolchains` fixture; locally that fixture's checks are skipped without it.
- Mutation checks, reverted: a `createNodes` in `src/index.ts` appeared in the graph (with `vendor/**` excluded through the fixture's `nx.json`), its `cargo metadata` calls appeared in the log, and inverted verdicts failed with the changed inputs named. After review: without the copy in `node_modules/.bin`, the `nx:run-commands` tests failed (unit and end-to-end) while the executor tests passed; without the wrapper's `PATH` change, a decoy `rustc` broke the build; without the cleanup in `create()`, its folder was left behind.

Checks run, last after the review fixes: `pnpm nx run-many -t build lint test` (21 unit tests), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (6 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete, no errors or warnings), `zban check`. CI on the pull request covers the check job with the added toolchain.

Rejected: running `nx graph` through the CLI (needs `node_modules` in the copy and returns no hashes); placing the copies inside this repository; loading the built plugin from `dist` (tests would depend on `build`). Found and filed: nxr-1ydrfd (rustup installs a missing toolchain when the plugin runs cargo).
