---
title: Schedule the heaviest unit specs first and pre-warm the third-party builds of the napi and wasm fixtures
status: done
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T16:37:46Z
closed_at: 2026-11-20T18:42:44Z
---

Goal: the unit suite stops wasting wall time on Jest's file order and on compiling the same third-party crates of the `napi-addons` and `wasm-packages` fixtures for every test, without weakening any assertion (`VER-ARTIFACTS`, `VER-BUILD-INPUT-CHECK`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026 (thread "Review and speed up nx-rust test suite"), measured at 9d3430a with `maxWorkers = 3` on a 32-core host and `NX_DAEMON=false`. The 11 heaviest unit specs took 323.0 s of wall time for 710.5 suite-seconds, an average concurrency of 2.20; 86.2 s were tail latency. `nx-rust/test/napi-build.spec.ts` alone took 162.9 s (15 tests) and was scheduled 10th of 11, which left two of three workers idle for about 125 s. It makes about 18 cold cargo builds of the 28 vendored crates under `napi-addons/registry/`, at 7 to 9 s each (slowest tests: lines 163-222 at 19.95 s, 575-599 at 18.89 s and 18.52 s, 642-710 at 16.24 s, 289-329 at 15.84 s).

- [x] Longest-first order: Jest has no `testSequencer` here, so on a fresh checkout or in CI it sorts by file size and runs `napi-build.spec.ts` near the end. Add a small sequencer beside `nx-rust/jest.config.cts` that puts the compile-heavy specs first (`napi-build`, `batch-runs`, `build-input-check`, `cache-keys`, `target-defaults`, `caching-runs`, `workspace-build`, `wasm-build`, `affected-coverage`) and leaves the rest to Jest's default order (`super.sort`)
- [x] One stable registry path: `copyFixture` (`nx-rust/test/harness/fixtures.ts`, around lines 196-199) copies the 2.9 MB `napi-addons/registry/` into every `$TMPDIR/nx-rust-napi-addons-XXXX/repo/registry`, and `rust/.cargo/config.toml` (line 7) names it as `local-registry = "../registry"`. Each copy therefore has another source identity for cargo, which compiles all 28 third-party crates again in every test. Point `local-registry` of each copy of `napi-addons` and `wasm-packages` at one stable read-only path (the fixture's own `registry/` folder) and stop copying `registry/` into the copies
- [x] A pre-warmed `target/`: build a template `target/` lazily, once per test run, under `testRunFolder()` (for `napi-addons` the default host build and `--target <host>`, so that lines 289-329 reuse the dependencies as well; for `wasm-packages` the host build and `wasm32-unknown-unknown` where that target is installed), and clone it into each copy with reflinks where the file system has them (`cp -a --reflink=auto`, or `fs.copyFileSync` with `COPYFILE_FICLONE`; btrfs here, APFS on macOS, a plain copy on ext4 in CI). Remove the template in `globalTeardown` (`nx-rust/test/harness/global-teardown.ts`)
- [x] Keep the crates of the workspace itself compiling fresh in every copy: either strip the members' artifacts and fingerprints from the template, or show that cargo fingerprints them again by the copy's absolute path, so that every `.d` file and every `NAPI_FORCE_BUILD_*` run is genuinely fresh. `napi-build.spec.ts` lines 458-486 ("leaves plain cargo to compile again only the napi crates and what depends on them") and every check of `VER-ARTIFACTS` and `VER-BUILD-INPUT-CHECK` must pass unchanged
- [x] The `it.each(ordinary)` runs of `napi-addons` and `wasm-packages` in `nx-rust/test/build-input-check.spec.ts` (7.41 s and 6.33 s) get the benefit without a change of their own
- [x] Combine the two `RUSTFLAGS` consumer cases (`napi-build.spec.ts` lines 575-599 and `nx-rust/test/wasm-build.spec.ts` lines 625-654): `it.each([[true, false], [false, true]])` creates two workspaces and runs `RUSTFLAGS="-C debuginfo=0"`, a full rebuild of 28 crates, twice (37.4 s). Put two JS consumer projects in one workspace, one with `{ dependentTasksOutputFiles: "**/*" }` and one without, so that one rebuild shows both the miss and the hit
- [x] Show for each change that the tests still fail when the behaviour they guard is broken (a temporary mutation is enough), and give the timings before and after

Not to do: do not drop fixtures or cases, do not raise `maxWorkers` above 3, do not start long-lived Nx processes (`EVD-NX-24-PROCESS-STATE`), and keep every temporary file under `$TMPDIR`.

Done when: the specs named above pass with unchanged assertions, the measured wall time of `napi-build.spec.ts` and of the unit suite is reported (the audit expects about 25 to 35 s for `napi-build.spec.ts`), and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/jest.sequencer.cjs` (named as `testSequencer` in `nx-rust/jest.config.cts`) starts the nine compile-heavy spec files first, in the order this issue lists them, and leaves the rest to `super.sort`. It extends `@jest/test-sequencer`, now a root devDependency (`~30.3.0`, the version of Jest installed here). The lockfile change is only that entry.
- `copyFixture` goes through `copyFixtureFiles`, which for `napi-addons` and `wasm-packages` (`localRegistries`) leaves `registry/` out of the copy and points `local-registry` in `rust/.cargo/config.toml` at the fixture's own registry folder. Before, every copy also unpacked the registry into a new `~/.cargo/registry/src/-<hash>` folder (about 1000 had piled up on this machine).
- `nx-rust/test/harness/fixture-builds.ts`:
  - `warmBuilds` is the table: fixture → its workspaces and the cargo commands to warm.
  - `buildTemplate` copies the fixture's files into a new folder and runs those commands there. Every cargo command gets the workspace's `target` folder in the template as its target and build directory: through `--target-dir`, and through `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR`, which take precedence over every configuration file. It refuses to build unless `cargo metadata` reports those directories. Then `cargo clean -p <member>…` runs for each triple and profile the builds used (the members' names come from `cargo metadata`). The harness no longer reads cargo's build layout.
  - `warmTemplate` builds a template once per test run in `<run folder>/fixture-builds/<fixture>`. The template, a failure and the lock each appear complete or not at all:
    - the template and the `.failed` file are written beside their place and renamed into it;
    - the lock is a hard link to a file that already holds its owner's process and token.
  - Taking over a dead owner's lock:
    - Only the one waiter that creates the claim file for that lock instance (with `wx`) removes the lock.
    - A lock without a readable owner counts as dead after 5 s.
    - A claim follows the same rule: if the waiter holding it dies, or the claim has no readable owner and is older than 5 s, the next claim, one number on, takes over.
    - Every removal is refused outside its own folder.
  - `placeWarmBuilds` clones each `target` with `cpSync` (`COPYFILE_FICLONE`, `preserveTimestamps`). Without a test run it does nothing.
  - To warm another fixture (for nxr-gabd3d), add an entry to `warmBuilds`: `{ folder: "<cargo workspace folder>", builds: [[...cargo args]] }`, with the commands exactly as its tests run them (same profile, features, `-p`/`--workspace` selection and triple).
  - The template is removed with the run folder by the existing `endTestRun` in `globalTeardown`.
- Guard tests "a copy of napi-addons / wasm-packages starts with the registry's crates compiled and none of its own" (host, `--target <host>`, and `--lib -p codec --target wasm32` where installed). For each build they check:
  - the folder of the profile's artifacts holds no file of the workspace;
  - after the copy's sources are dated 2001, older than anything in the template, the first build compiles exactly the workspace's targets and no other crate;
  - the records it writes name no path of the template.
- `fixture-builds.spec.ts` runs `buildTemplate` with a private Cargo home whose `config.toml` sets `build.target-dir` and `build.build-dir` to a folder holding another project's artifacts, records, incremental and build output. That folder is unchanged afterwards (file list and content hashes).
- The two `RUSTFLAGS` consumer cases in `napi-build.spec.ts` and `wasm-build.spec.ts` are each one workspace with `web` (`dependentTasksOutputFiles`) and `web-plain` (without it), run with `run-many -t build -p web web-plain`. They first assert that `web:build` and `web-plain:build` both ran in each run; then, as before, the artifact build is not restored, `web` misses and `web-plain` hits.
- `nx-rust/test/README.md` describes the shared registry, the template, and why the copies compile their own crates.

### What `cargo clean -p` leaves

A one-off scan of templates with the earlier layout reader, not part of the harness:

- installed Cargo 1.100: nothing of the members;
- Cargo 1.91: the members' build-script incremental folders (`target/debug/incremental/build_script_build-*`, six for napi-addons, none for wasm-packages).

The guard tests pass on 1.91 with them, so they do not make cargo count any member as compiled; the review's replay showed rustc ignored them for all three build scripts. The code comment and the README say this rather than that the template holds nothing of the members.

### Temporary mutations (all reverted)

Round 1 ran each mutation on this branch and, for production code, also on a clean export of `main`:

| Mutation | Result |
| --- | --- |
| No `NAPI_FORCE_BUILD_*` | The `napi_build::setup()` test fails, on both trees |
| napi-build touches `crates/shared/src/lib.rs` | "leaves plain cargo to compile again only the napi crates …" fails with `+plain_cdylib, +shared`, on both trees |
| Input check counts every recorded file as undeclared | The ordinary napi-addons and wasm-packages runs fail with the same 20 crate/file pairs on both trees |
| Input check returns early | The wasm undeclared-include case fails, on both trees |
| napi-build outputs drop `index.d.ts` | The batch/restore case fails on the unchanged-hash assertion, on both trees |

After the review:

| Mutation | Result |
| --- | --- |
| No `cargo clean -p` | Both guard tests fail on Cargo 1.100 and 1.91 (artifact files present) |
| No `cargo clean -p`, only the profile folders' top-level files removed | Both guard tests fail on 1.100 and 1.91 (every member counted as compiled already) |
| No clone into copies | Both guard tests fail on 1.100 and 1.91 |
| Template build without the directory pinning, `--target-dir` and refusal | `fixture-builds.spec.ts` fails (the shared folder gains the build) |
| Only `web`'s build target renamed | Both consumer cases fail on `ran` |
| `web-plain` given the input, or `web` without it | The consumer cases fail (round 1) |

Lock probes:
- A lock of a dead owner is taken over in about 4 s.
- An empty lock 10 s old is taken over in about 5 s.
- A dead owner's lock whose claim belongs to a waiter that died, and one whose claim is empty and 10 s old, are both taken over through the next claim in about 6 s.
- Three processes facing a dead owner's lock compile the third-party crate once.

### Timings

`berth --exclusive`, `maxWorkers` 3, `--skip-nx-cache`; other agents shared the machine (load average 3 to 11).

| Run | Before | After, round 1 | After, round 2 |
| --- | --- | --- | --- |
| `napi-build.spec.ts` | 91.9 s, 88.9 s | 36.5 s | 39.3 s |
| `wasm-build.spec.ts` (Cargo 1.100 with the wasm target and the real CLI) | 43.9 s | 30.5 s | 31.9 s |
| `build-input-check.spec.ts` alone | 58.7 s | 62.5 s (template build in its critical path) | — |
| Whole unit suite, back-to-back pair (round 1) | 407.3 s | 387.4 s | — |

- In the whole-suite pair, `napi-build.spec.ts` starts at 0 s and takes about 43 s instead of starting at 267 s and taking 102.5 s.
- The napi-addons template is about 300 MB, shared by reflinks on btrfs.

### Checks run

On 1a0466d, the merge of local `main` at 29aee8e:

- `pnpm nx run-many -t build lint test --skip-nx-cache`: 78 suites, 2072 passed, 61 skipped, 6 todo.
- `pnpm nx e2e nx-rust-e2e`, after the unit suite: 27 passed.
- The napi, wasm and fixture-builds specs with Cargo 1.91 through a private `RUSTUP_HOME`: 25 passed, 6 skipped (no wasm target on 1.91).
- `pnpm nx format:check --all`: passes.
- `mara schema validate`, `mara project validate` and `zban check`: pass.

## Decisions made

- The harness does not read cargo's build layout. The template is cleaned with `cargo clean -p` per member, against the template's own pinned target and build directory (the review's decision).
- The guards check freshness independently of file times by dating the copy's sources before the template.
- The shared local registry applies in `copyFixture` for every caller; the end-to-end tests use neither fixture.
- The template is built lazily by the first worker, and the others wait. A failed template build fails every copy of that fixture with cargo's message.
- wasm-packages warms `build --lib --workspace --target wasm32-unknown-unknown`, which also serves the per-crate `-p codec --lib` compile of wasm-build.
- An interrupted run also leaves the template in its run folder, and the copies (`$TMPDIR/nx-rust-*`, left behind as before) a cloned `target`. `~/.cargo/registry/src` gains one folder per checkout and fixture instead of one per copy.
