---
title: Reuse test registries and daemon workspaces and remove fixed sleeps in the unit tests
status: todo
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T16:37:58Z
---

Goal: the release, lockfile and daemon tests stop paying for a new registry process, a new git commit, a fixed sleep or a cold build where one shared and cleanly reset resource proves the same thing. No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `release-registries.spec.ts` 27.0 s, `release-publish.spec.ts` 23.8 s (one test of 5.77 s with a 4 s sleep), `release-version.spec.ts` 16.5 s, `caching-runs.spec.ts` 65.3 s (three daemon `it.each` tests of about 5.5 s each, seven spawns in a row in the profile test at 6.33 s).

- [ ] Shared sparse registry: `withPublishCopy` (`nx-rust/test/harness/publish-runs.ts`, lines 65-91) forks a new `registry-server.mts` Node process for every test, about 45 forks over `release-registries`, `release-publish`, `release-publish-dry-run`, `release-unpublished` and `release-lockfile`. Add an IPC message `{ type: "reset" }` to `nx-rust/test/harness/registry-server.mts` (around lines 513-520) and `sparse-registry.ts` that stops timers, clears `waiting`, wipes the registry folders, `uploads.jsonl` and `requests.jsonl`, and sets `indexDelay` back to 0, so that each spec file shares one server from `beforeAll` to `afterAll` and every test still starts from an empty registry
- [ ] Add an IPC message `{ type: "flush-index" }` that puts every waiting upload into the index at once and replies, and use it in `nx-rust/test/release-publish.spec.ts` (lines 255-279): `setIndexDelay(Infinity)` and `flushIndex()` right after cargo's one-second timeout failed, instead of `setIndexDelay(4000)` and polling every 200 ms (about 3.5 s, and no dependence on timers)
- [ ] One commit per local registry: `LocalRegistry.create(crates)` (`nx-rust/test/harness/local-registry.ts`, lines 78-116) commits after each crate (9 commits in `lockfile-keys.spec.ts`, 4 in `lockfile-runs.spec.ts`). Add and commit once at the end; optionally keep packaged `.crate` files by content hash under `testRunFolder()`
- [ ] `nx-rust/test/test-after-build.spec.ts` line 143: `within(4000, ...)` waits 4 s in each of two cases without condition. Shorten the hold to about 750 to 1000 ms after `hold.held()` fired, and check once, with a temporary negative run, that without the dependency Nx starts `app:test` well within that time
- [ ] `nx-rust/test/caching-runs.spec.ts` line 634: delete the second `nx run cli:build --configuration=plain` call, which repeats what the loop over `[[], ["--batch"]]` at lines 616-633 already ran with the same assertion
- [ ] Daemon cases (`caching-runs.spec.ts` lines 650-723 and `nx-rust/test/artifact-folders.spec.ts` lines 124-150): six separate cold builds of `crate-shapes` with a daemon each, about 32 s together. Reuse one `crate-shapes` workspace and its warm `target/` across the three cases of each spec file, and reset the external `.cargo/config.toml` or `CARGO_HOME/config.toml`, `.nx/cache` and the daemon's state between the cases; keep every `nx daemon --stop` and every restore assertion
- [ ] Show for each change that the tests still fail when the behaviour they guard is broken, and give the timings before and after

Done when: the specs named above pass with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
