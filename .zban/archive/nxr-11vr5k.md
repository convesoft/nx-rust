---
title: Reuse test registries and daemon workspaces and remove fixed sleeps in the unit tests
status: done
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T16:37:58Z
closed_at: 2026-11-20T19:24:58Z
---

Goal: the release, lockfile and daemon tests stop paying for a new registry process, a new git commit, a fixed sleep or a cold build where one shared and cleanly reset resource proves the same thing. No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `release-registries.spec.ts` 27.0 s, `release-publish.spec.ts` 23.8 s (one test of 5.77 s with a 4 s sleep), `release-version.spec.ts` 16.5 s, `caching-runs.spec.ts` 65.3 s (three daemon `it.each` tests of about 5.5 s each, seven spawns in a row in the profile test at 6.33 s).

- [x] Shared sparse registry: `withPublishCopy` (`nx-rust/test/harness/publish-runs.ts`, lines 65-91) forks a new `registry-server.mts` Node process for every test, about 45 forks over `release-registries`, `release-publish`, `release-publish-dry-run`, `release-unpublished` and `release-lockfile`. Add an IPC message `{ type: "reset" }` to `nx-rust/test/harness/registry-server.mts` (around lines 513-520) and `sparse-registry.ts` that stops timers, clears `waiting`, wipes the registry folders, `uploads.jsonl` and `requests.jsonl`, and sets `indexDelay` back to 0, so that each spec file shares one server from `beforeAll` to `afterAll` and every test still starts from an empty registry
  - Done differently: the shared server starts with the first test that uses it (`withSharedRegistry`), not in `beforeAll`, and is reset before each later test; `afterAll(removeSharedRegistry)` removes it.
- [x] Add an IPC message `{ type: "flush-index" }` that puts every waiting upload into the index at once and replies, and use it in `nx-rust/test/release-publish.spec.ts` (lines 255-279): `setIndexDelay(Infinity)` and `flushIndex()` right after cargo's one-second timeout failed, instead of `setIndexDelay(4000)` and polling every 200 ms (about 3.5 s, and no dependence on timers)
- [x] One commit per local registry: `LocalRegistry.create(crates)` (`nx-rust/test/harness/local-registry.ts`, lines 78-116) commits after each crate (9 commits in `lockfile-keys.spec.ts`, 4 in `lockfile-runs.spec.ts`). Add and commit once at the end; optionally keep packaged `.crate` files by content hash under `testRunFolder()`
  - Done differently: one commit at the end and one before each crate with dependencies, which `cargo package` resolves against the committed index (3 commits instead of 10 in lockfile-keys, 1 instead of 5 in lockfile-runs). The `.crate` cache was not added.
- [x] `nx-rust/test/test-after-build.spec.ts` line 143: `within(4000, ...)` waits 4 s in each of two cases without condition. Shorten the hold to about 750 to 1000 ms after `hold.held()` fired, and check once, with a temporary negative run, that without the dependency Nx starts `app:test` well within that time
  - Done: a hold of 1000 ms. The negative run showed that in this default batched run Nx does not start `app:test` early even without the dependency; with `--batch=false` it does within 50 ms. Filed as nxr-7v04ge.
- [x] `nx-rust/test/caching-runs.spec.ts` line 634: delete the second `nx run cli:build --configuration=plain` call, which repeats what the loop over `[[], ["--batch"]]` at lines 616-633 already ran with the same assertion
- [x] Daemon cases (`caching-runs.spec.ts` lines 650-723 and `nx-rust/test/artifact-folders.spec.ts` lines 124-150): six separate cold builds of `crate-shapes` with a daemon each, about 32 s together. Reuse one `crate-shapes` workspace and its warm `target/` across the three cases of each spec file, and reset the external `.cargo/config.toml` or `CARGO_HOME/config.toml`, `.nx/cache` and the daemon's state between the cases; keep every `nx daemon --stop` and every restore assertion
  - Not done: a shared copy was built and measured and saved nothing (see Decisions made); the orchestrator accepted leaving the daemon cases unshared.
- [x] Show for each change that the tests still fail when the behaviour they guard is broken, and give the timings before and after

Done when: the specs named above pass with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `registry-server.mts` takes `{ type: "reset" }`: it stops the timers of the index delay, forgets waiting uploads, sets the delay back to 0, closes its connections, bumps a generation so that a request begun before the reset writes nothing to the registry's files or logs, `server.log` included, and deletes every index, `.crate` file, `uploads.jsonl`, `requests.jsonl` and the named registries' folders. It answers `reset-done`, with the error where a deletion failed. `{ type: "flush-index" }` puts every waiting upload into its index and answers with the count.
- `SparseRegistry.reset()` asks for that, deletes what cargo and `seed` left in the Cargo homes and the folder (`sources`), writes the homes' configuration again and throws where anything of the server's is left. `flushIndex()` and the `stopped` getter are new; `setIndexDelay` shares one request helper with them.
- `withSharedRegistry(test)` and `removeSharedRegistry()` (`sparse-registry.ts`): one server per test file, started by the first test and reset before each later one. A failed reset fails the test that asked for it and drops the server. A test after one that stopped the server gets a new one, and a test that runs while another uses it gets a server of its own. `withPublishCopy` and `withLockfileCopy` (release-lockfile) use it, and the five release specs call `afterAll(removeSharedRegistry)`.
- release-publish: `setIndexDelay(Infinity)` and `flushIndex()` instead of a 4 s delay and polling.
- `LocalRegistry.create` commits the index once at the end and before a crate with dependencies (lockfile-keys: 3 commits instead of 10, lockfile-runs: 1 instead of 5). `publish()` still commits each version.
- test-after-build: hold of 1000 ms instead of 4000 ms. caching-runs: the repeated `--configuration=plain` run is deleted.
- New tests in `sparse-registry.spec.ts`: flush; a reset after index entries, uploads in `alpha`, a timed and a never-shown waiting upload, a changed Cargo home config, a cache file in the home and `sources`, which finds everything empty, delay 0, no waiting upload and no late timer; a failed reset, made by moving the registry's folder away so that the server cannot create its index again, which fails for root as for anyone; a stopped server and nested use; frozen registry descriptors; the check of a delay given to `setIndexDelay`.
- After review: the reset stops every registry's timers before it deletes anything, so that a deletion that fails leaves no timer running; an upload cut off by a reset is refused with 503 and not logged to `server.log`; `named` and `spare` are frozen, so that a test cannot change what `env()` gives the next one; `setIndexDelay` checks and rounds a delay as `start()` does, so that a delay given to `withSharedRegistry` is checked as before; the timer test checks that the timed upload still waits when the first test ends and waits from the upload's time. `VER-RELEASE` says that a group 4 case finds its registry empty on the spec file's shared server (no criterion changed).
- The test README describes the shared registry and `flushIndex`.

Mutations, each run against the named spec and then reverted (none is in the branch):

- reset keeps timers and waiting uploads: the reset test fails
- reset keeps the index delay: the reset test fails
- reset keeps `requests.jsonl`: the reset test fails
- the homes are not wiped: the reset test fails
- flush appends nothing: the release-publish case fails
- no reset between tests: 18 of 19 release-registries tests fail
- no commit before a dependent crate: all 17 lockfile-keys tests fail
- no final commit: 11 of the lockfile-runs "lockfile task" tests fail
- after review, the server forgets waiting uploads but does not clear their timers: the reset test fails on the timed upload that appears after the reset
- after review, the server creates its index folder again with `recursive`, so that the moved-folder reset succeeds: the failed-reset test fails
- after review, the named descriptors are not frozen: the nested-use test fails
- the remedy text of the cleared-triple message is changed: the caching-runs case fails in the loop's first iteration, which runs the deleted call's command (no flag, so Nx honours `preferBatch` and batches it, as the deleted call did) with its assertion
- `testBuilds` returns `[]` (no dependency, no guard): the two hold cases of test-after-build still pass, before and after this change. In the default batched run, Nx did not start `app:test` within 8 s or 20 s while build was held. With `--batch=false` it started it before the first 50 ms poll. Filed as nxr-7v04ge. Five of the other six cases fail; the case whose continuous helper waits for build passes too.

Timings with `berth --exclusive`, `maxWorkers` 3, old code then new, wall time of each spec:

- release-publish: 17.3 → 14.3 s (the flush case 5.19 → 2.18 s)
- test-after-build: 22.7 → 16.5 s (hold cases 6.47/5.59 → 3.20/2.61 s)
- release-registries: 21.6 → 21.1 s (two more exclusive pairs: 19.7/19.8 → 18.8/18.8 s)
- release-unpublished: 5.9 → 6.1 s (pairs: 6.0/6.1 → 5.9/5.9 s)
- release-publish-dry-run: 3.4 → 3.4 s
- release-lockfile: 18.6 → 18.5 s
- lockfile-keys: 26.3 → 25.5 s
- lockfile-runs: 66.3 → 66.5 s
- caching-runs: 51.2 → 50.4 s
- artifact-folders: 33.3 → 33.5 s
- sparse-registry: 9.9 → 10.9 s (four new tests; the old tests sum to 9.8 → 9.9 s)

Differences under about 1 s are within the noise: unexclusive runs under load averages of 6 to 16 drifted by 2 to 10 s per spec.

Checks, after merging `main` at 29aee8e (merge commit 35422fa) and the review fixes: `pnpm nx run-many -t build lint test` passed (77 suites, 2074 tests passed, 62 skipped, 6 todo); `pnpm nx e2e nx-rust-e2e`, run after the unit suite, passed (27 tests); with a private `RUSTUP_HOME` whose default toolchain is 1.91.0, the release, lockfile and sparse-registry specs passed (11 suites, 367 passed, 1 skipped); `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings) and `zban check` passed. The CI-env variant does not apply: no changed test sets `CI`, `GITHUB_ACTIONS` or agent variables. `VER-RELEASE` changed in wording only.

## Decisions made

- Daemon cases of caching-runs and artifact-folders: not changed. One shared `crate-shapes` copy, reset between cases (`.nx`, outer Cargo configuration, Cargo home, `rust/target` kept aside), was built and passed in any order. It saved nothing: about 4.5 to 6 s per case before and after, because a cold `cargo build -p cli` plus `cargo doc` of crate-shapes takes about 0.3 s, and the rest is Nx and daemon start-up. Shared state with no gain was dropped.
- The shared registry is reset at the start of each use, not at the end, so that a test that failed or timed out mid-way cannot leave state for the next one.
- Cargo homes are wiped on reset, beside the server's files: cargo's index cache and downloaded `.crate` files there would otherwise carry a test's versions into the next one.
- `LocalRegistry` keeps one commit before each crate with dependencies, because `cargo package` resolves against the committed index; the mutation above shows that.
- The hold is 1000 ms. Nx starts `app:test` within the first 50 ms poll where it can, so 1000 ms leaves a margin of more than 20 times; in the batched run the hold cannot be too short, because Nx does not start the task early there.
- The packaged `.crate` cache by content hash (optional in the issue) was not added.
