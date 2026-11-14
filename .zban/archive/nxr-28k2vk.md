---
title: "Spike: answer many graph and hash requests of a fixture from one Nx session"
status: done
type: task
tags:
  - tests
  - spike
created_at: 2026-11-14T12:06:52Z
closed_at: 2026-11-14T13:40:15Z
---

Goal: find out, by measurement, whether one long-lived Nx session per fixture state, a child process started in the fixture's root that answers many graph, hash, file and glob requests, can replace the fresh child process that the harness starts for each such call today, with provably the same results; and either adopt it where it pays or drop it, with the knowledge recorded.

Context: asked for by the maintainer on 14 November 2026. One unit run starts about 1,680 Nx processes for about 1,160 tests, because `FixtureWorkspace.inspect` starts `inspect-workspace.cjs` afresh for every `graph()`, `hashTasks()`, `taskFiles()` and `glob()` (Nx fixes its workspace root when it is loaded), and many matrix rows build the same fixture and differ in one variable. The CI unit step took 9m22s on `main` fa40259. Pull request #58 already compiles the plugin once and loads it in Nx's own process; its fifth candidate, "a persistent helper per fixture, only if it provably gives the same results", is this spike. Splitting the plugin into packages was considered and rejected for now. The verification approach is `VER-CACHE-KEYS` and the harness of `verification.mara.md`; nothing may replace a check of the resulting key or graph by a check of what the plugin declares (the defect that #64 fixed).

Scope: `nx-rust/test/cache-keys.spec.ts` and `nx-rust/test/declared-files.spec.ts`. The fresh process stays the default; a test asks for the session explicitly. Tests of what Nx restores from the cache, of the daemon, of `pluginWorkers`, of `nx affected` and of real task runs keep fresh processes. Out of scope: `.github/workflows`, restructuring `nx-rust/src`, splitting the suite into Nx projects, `nx affected` on pull requests.

Other work on the same files: #74 (deletes tests, adds two rows to `cache-keys.spec.ts`) and a second pull request that rewrites the slowest test of `cache-keys.spec.ts` to hash once; #73 changes `discovery.spec.ts`, `redirections.spec.ts` and `warnings.spec.ts`. Measure "before" on the commit this work starts from, merge `origin/main` when they land and measure again.

- [x] Measure the "before" on `main` fa40259: Nx process starts, wall time of each of the two files alone (a few runs, with what else was running), peak memory
- [x] Find in the installed Nx 24.0.6 what a process keeps between two graph or hash computations (workspace context and file hashes, cached project graph, plugin module state, environment read once) and how Nx itself resets it; confirm by experiment
- [x] Build the session in the harness: started in the fixture's root, one request at a time, a fresh environment per request, reset between requests, ended when the workspace is removed, also when a test fails; the fresh process stays the default
- [x] Prove the same results: run every row of the two files both ways in one test run and compare graph and hashes, with hash details, value by value
- [x] List the tests that must keep fresh processes, and why, and how the harness keeps the two ways apart
- [x] Measure the "after" (process starts, wall time, peak memory) and estimate CI; repeat both after merging #74 and the rewrite if they land
- [x] Recommend rolling out or dropping, naming the spec files where it would pay and what the whole unit run would cost
- [x] Record what Nx 24.0.6 keeps in a process and how it is reset as an evidence item in Mara, update `nx-rust/test/README.md`, and add what concerns memory to nxr-2bdrk4

Done when: the evidence item is accepted and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation; the numbers and the recommendation are recorded here; if the numbers justify it, the two spec files use the session where it is safe, with a comparison guard; `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `zban check` pass.

## Numbers

Machine: 32 cores, 14 GB, Linux, Node.js 26.12.0, Nx 24.0.6, cargo 1.100.0; other agents ran their own test suites meanwhile (load average 2 to 9, noted per run). Each file ran alone with `pnpm nx test @convesoft/nx-rust --testPathPatterns=<file>`, `NX_DAEMON=false` for the outer Nx, in a transient systemd scope whose anonymous memory was sampled every 0.5 s; "before" ran in a worktree of `main`, "after" on the spike branch merged with the same `main`, alternating. Times are Jest's; "Nx processes" counts fresh `inspect-workspace.cjs` and `nx` processes and sessions.

| `main` | file | before | after | Nx processes before → after | peak anon. memory before → after |
| --- | --- | --- | --- | --- | --- |
| fa40259 | `cache-keys.spec.ts` (96 tests) | 67.3, 68.8, 68.3 s (80.0 s at load 9) | 50.2, 53.9, 53.7 s | 246 → 25 + 23 sessions | 950–990 → 1180–1290 MB |
| fa40259 | `declared-files.spec.ts` (101) | 70.3, 70.5, 74.4, 80.1 s | 60.4, 56.7, 64.8 s | 176 + 92 `nx` → 4 + 92 | 1310–1450 → 1380–1640 MB |
| 0a28a83 (#73, #74) | `cache-keys.spec.ts` (98) | 67.0, 65.3 s | 50.7, 50.4 s | 250 → 25 + 25 sessions | 950–990 → 1230 MB |
| 0a28a83 | `declared-files.spec.ts` | 69.3, 69.1 s | 54.6, 54.4 s | 176 + 92 → 4 + 92 | 1180–1210 → 1300–1350 MB |
| e8958bb (#75) | `cache-keys.spec.ts` (98) | 57.6, 56.8 s | 44.4, 44.4 s | 223 → 25 + 25 sessions | 1025–1040 → 1240–1250 MB |
| e8958bb | `declared-files.spec.ts` (101) | 68.5, 68.0 s | 53.8, 53.8 s | 176 + 92 → 1 + 3 sessions + 92 | 1240–1270 → 1370–1400 MB |

On e8958bb: −22% and −21%, 27 s together. The check mode (`NX_RUST_TEST_SESSIONS=check`, every session answer compared with a fresh process, values that two fresh processes disagree on excepted) passed on all 197 tests on fa40259, the 98 of `cache-keys.spec.ts` on 0a28a83 and all 199 on e8958bb.

Full unit run on e8958bb with fresh processes only: 223 s with three workers, 588 s summed over the files; 867 graph/hash/file/glob requests took 205 s (35%), 799 `nx` commands 360 s (61%); the spec files that run no Nx in a fixture took 6 s (1%). Node also started 4680 times for the cargo wrapper and 1179 times for the plugin's artifact folder input.

CI estimate: the CI unit step runs three workers on four cores at about three times this machine's time per test, so it saves about as many seconds of wall time as the files save here summed: about 27 s of 9m22s (5%) for the two files. A rollout to every other file is bounded by their 468 remaining requests at about 70 ms each, about 33 s more (to about 11% in all), and only where tests share a session workspace; most of those files create a workspace per test for one to three requests (`graph.spec.ts` 75, `redirections.spec.ts` 74, `configuration.spec.ts` 70, `caching.spec.ts` 48, `warnings.spec.ts` 46, `lockfile-keys.spec.ts` 30, `discovery.spec.ts` 27, `targets.spec.ts` 24, others fewer).

## Which tests keep fresh processes

Every `nx()` command: real task runs and what Nx restores from its cache (`caching-runs`, `lockfile-runs`, `executors`, `build-input-check`, …), `nx affected` (its process computes the graph and the touched files itself), the daemon (`NX_DAEMON=true`), and `pluginWorkers` (`NX_ISOLATE_PLUGINS=true`): a session cannot change variables that start with `NX_` or `NODE_`, so the measured harness sent such requests to a fresh process; and tests that change what lies beside the copy or load the plugin from its TypeScript source kept workspaces of their own. The measured harness kept the ways apart by an explicit `useSession()` per workspace (fresh by default), `nx()` never using the session, and a refusal of any request whose `NX_`/`NODE_` variables differ from the session's.

## Summary of Changes

Recommendation: drop the session for now. It gives the answers of fresh processes, but only by loading Nx afresh for each request, which leaves about 70 ms to save per request; that is 27 s of the unit run's 588 s file time in the two files that ask most, and at most about 11% of the CI step with a full rollout, while each Jest worker with a session holds about 130 to 220 MB more at its peak (nxr-2bdrk4) and the harness would depend on how Nx 24 loads itself (the module cache, `removeDbConnections`, the `process.emit` wrapper of `native/index.js`), to be proven again with the check mode on every Nx upgrade. The cargo wrapper's Node start-up costs more than the session saves in the whole suite, without those costs: filed as nxr-3tffj9. The comparison guard therefore does not stay; it would only be worth keeping, as a sample of every tenth answer, together with the session.

- `EVD-NX-24-PROCESS-STATE` (`nx-rust/docs/decisions.mara.md`): what Nx 24.0.6 keeps in a process, with files and lines, the experiments, the proof, time, memory and where the unit run's time goes.
- `nx-rust/test/README.md`: why each graph, hash, file and glob call starts its own process.
- nxr-2bdrk4: the memory measurements, issue left open.
- The session as measured (harness, both spec files, check mode) is the first commit of pull request #76; its second commit removes it again, so the squash merge keeps only the knowledge.

Rejected approaches: keeping Nx's modules loaded and resetting only the workspace context, the plugins and the plugin's modules (wrong keys after a change of the environment or of a crate's `.env`, through `taskSpecificEnvCache`); reloading only Nx's and the plugin's modules and keeping third-party ones (no faster); reloading the native addon too (no smaller); `setWorkspaceRoot` to serve several roots from one process (as read in the source, the cache and workspace data folders stay those of the first root).

Checks run: `mara schema validate` and `mara project validate` (`valid: true`, `evaluation_complete: true`), `zban check`, `pnpm nx run-many -t build lint test` (36 suites, 1140 passed, 1 todo) and `pnpm nx format:check --all`, all passing on the final state; the check mode and timing runs above on the implementation commit.
