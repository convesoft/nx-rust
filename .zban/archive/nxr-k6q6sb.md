---
title: Speed up the unit tests without dropping a case
status: done
type: task
tags:
  - tests
created_at: 2026-11-13T21:21:34Z
closed_at: 2026-11-13T22:52:24Z
---

Goal: CI's step `pnpm nx run-many -t build lint test` takes much less than its 10 minutes 41 seconds on `main` (run 43505726435, a 4-core runner, 3 Jest workers), while every test that exists today still exists, runs and proves what it proves. The maintainer chose to speed up the tests rather than split the CI job, and asked whether the commands can be called programmatically with the same result.

## Context

Measured on 13 November 2026 on a 32-core machine with 14 GB of RAM, Nx 24.0.6; to be verified before relying on it.

- The suite has about 830 tests in 28 files, which sum to about 760 seconds, a bit under one second per test. Nearly every test starts at least one Nx process in a fixture repository. In `subfolder-workspace`: `nx show projects` 0.7 to 0.8 s, `nx run model:check` 1.5 s cold and 1.1 s as a cache hit, `nx run-many -t build test` 2.4 s. The fixture crates are tiny, so cargo is a small part.
- The harness already calls Nx's own functions for graphs and hashes (`nx-rust/test/harness/inspect-workspace.cjs`: `createProjectGraphAsync` and the task hasher), but in a new child process per call, because Nx fixes its workspace root from the current folder when its modules load (`nx/src/utils/workspace-root.js`) and keeps process-wide state.
- One graph call takes about 550 ms. `NX_PERF_LOGGING=true` shows loading the plugins, each into its own worker process, at about 410 ms, of which loading this plugin from TypeScript source is 188 ms; the plugin's `createNodes`, including `cargo metadata`, 60 ms; `createDependencies` 2 ms. With `NX_ISOLATE_PLUGINS=false` the same call takes about 290 ms. Requiring the plugin alone costs about 90 ms from TypeScript through swc and 14 ms compiled (`dist/nx-rust/src/index.js`).
- Largest files (3 workers, local): cache-keys 97 s, executors 76 s, lockfile-runs 57 s, unknown-options 57 s, lockfile-keys 55 s, caching-runs 52 s, configuration 51 s, target-defaults 49 s, run-arguments 46 s, graph 46 s.

## Constraints

- Every change gives the same results as today. No case is dropped, skipped or merged away, and the `VER-` items stay as they are.
- Tests of cache keys, cache restores, `nx affected`, the daemon and concurrent commands keep fresh real Nx processes for the step that must see a change: their point is that a new `nx` command sees it.
- No long-lived helper process that keeps Nx's state between requests, unless the existing cache-key rows, run both ways, show that it returns the same hashes after every kind of change.
- The change stays in the harness and in how tests call it, not in what they assert.

## Steps

- [x] Measure first: the duration per spec file and, inside the slowest files, how many Nx processes each starts and what they cost, locally with 3 workers; put the table in this issue and decide from the numbers
- [x] Run the fixtures' Nx commands and the harness's graph and hash calls with `NX_ISOLATE_PLUGINS=false` by default (in `FixtureWorkspace`'s environment rather than `testEnvironment()`, see Decisions), keeping a small, named set of tests (and the daemon tests) in Nx's default isolated mode; check in the installed Nx what else the variable changes
- [x] Load the compiled plugin in the fixtures in place of the TypeScript source, if the `test` target can depend on `build` without making local test runs awkward and without losing useful stack traces or the Mara code links; record the choice and why
- [x] Weigh calling the executor function directly with a real executor context in place of a whole `nx run` where a test only checks which cargo command a target runs: not done, see Decisions
- [x] Weigh starting fewer processes inside a test where several calls ask for the same unchanged state: not done, see Decisions
- [x] Show the effect: per-file and total durations before and after, locally with 3 workers, and the CI job's duration on the pull request against 10m41s on `main`; say what did not pay (the CI duration is read from the CI run of pull request #58, which covers it)

Done when: the measurements are in this issue, the same tests exist and pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e --skip-nx-cache` pass.

## Measurements

Taken on 13 November 2026 on the 32-core machine with 14 GB of RAM: Nx 24.0.6, Node 26.12.0, cargo 1.100.0, three Jest workers. Other agents ran their suites at the same time (load average 6 to 25), so every wall time below is a single run under load unless it says otherwise. CPU time, the user plus system time of every process that a run started, read from the `cpu.stat` of a systemd scope of its own, bends much less under load. Base is `origin/main` at 2765657; the branch is this change merged with it. Both ran the same 867 tests (866 passed, 1 todo, identical names) and started the same 1057 Nx processes.

### Full unit runs (`pnpm nx test @convesoft/nx-rust --skip-nx-cache`)

| Variant | CPU time, user + system | Wall time | Sum of file durations |
| --- | --: | --: | --: |
| Base | 1986 s (1235 + 751) | 348 s | 1033 s |
| Plugins in Nx's process only | 1202 s (704 + 498) | 263 s | 782 s |
| Compiled plugin only | 1523 s (960 + 563) | 252 s | 746 s |
| Both (this change) | 783 s (460 + 322) | 161 s | 475 s |

### Single spec files run alone (`--maxWorkers=1`), three runs each, minimum

| File | Base wall | Branch wall | Base CPU | Branch CPU |
| --- | --: | --: | --: | --: |
| `cache-keys.spec.ts` | 92.0 s (113.1, 92.0, 118.2) | 45.7 s (45.7, 48.1, 53.7) | 176 s | 76 s |
| `executors.spec.ts` | 73.6 s (73.6, 77.9, 96.9) | 35.6 s (35.6, 46.1, 55.6) | 154 s | 68 s |
| `lockfile-runs.spec.ts` | 46.2 s (46.2, 67.7, 74.5) | 28.8 s (28.8, 40.0, 51.3) | 84 s | 52 s |

### Per spec file, from the four full runs (seconds, single runs under load)

| File | Tests | Nx processes | Base | Plugins in Nx's process | Compiled copy | Both |
| --- | --: | --: | --: | --: | --: | --: |
| `cache-keys.spec.ts` | 72 | 183 | 148.8 | 96.0 | 109.5 | 60.2 |
| `executors.spec.ts` | 31 | 55 | 100.8 | 87.8 | 60.3 | 46.4 |
| `unknown-options.spec.ts` | 19 | 47 | 78.3 | 73.5 | 46.6 | 44.7 |
| `lockfile-runs.spec.ts` | 16 | 49 | 71.9 | 67.7 | 45.5 | 45.1 |
| `configuration.spec.ts` | 83 | 78 | 63.9 | 40.2 | 44.2 | 25.2 |
| `caching-runs.spec.ts` | 16 | 43 | 61.1 | 55.3 | 40.8 | 32.7 |
| `lockfile-keys.spec.ts` | 16 | 63 | 60.4 | 55.2 | 46.9 | 34.1 |
| `target-defaults.spec.ts` | 57 | 69 | 59.8 | 36.0 | 43.3 | 24.0 |
| `declared-files.spec.ts` | 19 | 59 | 53.6 | 35.3 | 43.0 | 19.6 |
| `graph.spec.ts` | 53 | 78 | 51.2 | 41.5 | 33.1 | 25.4 |
| `run-arguments.spec.ts` | 13 | 39 | 41.9 | 44.0 | 28.9 | 28.0 |
| `init.spec.ts` | 57 | 38 | 35.5 | 18.8 | 28.8 | 10.4 |
| `targets.spec.ts` | 40 | 41 | 34.9 | 17.1 | 28.3 | 10.1 |
| `caching.spec.ts` | 38 | 42 | 33.6 | 17.7 | 27.9 | 10.2 |
| `redirections.spec.ts` | 31 | 35 | 29.8 | 21.3 | 23.3 | 11.0 |
| `discovery.spec.ts` | 56 | 37 | 29.0 | 17.7 | 26.0 | 10.7 |
| `cargo-directories.spec.ts` | 12 | 22 | 16.2 | 13.1 | 17.1 | 8.2 |
| `compatibility.spec.ts` | 42 | 23 | 15.3 | 11.1 | 12.9 | 7.5 |
| `vendored-sources.spec.ts` | 13 | 19 | 13.5 | 7.6 | 11.5 | 4.9 |
| `plugin-version.spec.ts` | 8 | 11 | 9.3 | 6.9 | 7.9 | 4.0 |
| `crate-generators.spec.ts` | 17 | 11 | 9.1 | 5.7 | 7.0 | 3.2 |
| `missing-tools.spec.ts` | 24 | 6 | 5.9 | 4.5 | 4.4 | 2.5 |
| `cargo-wrapper.spec.ts` | 6 | 3 | 2.6 | 2.1 | 2.5 | 1.6 |
| `missing-toolchain.spec.ts` | 5 | 4 | 2.5 | 1.8 | 2.4 | 1.3 |
| `version-req.spec.ts` | 44 | 0 | 2.1 | 2.0 | 2.1 | 2.1 |
| `fixtures.spec.ts` | 29 | 0 | 1.3 | 1.3 | 1.2 | 1.1 |
| `fixture-workspace.spec.ts` | 2 | 2 | 0.9 | 0.9 | 0.7 | 0.7 |
| `lockfile-digest.spec.ts` | 29 | 0 | 0.2 | 0.0 | 0.1 | 0.1 |
| `split-words.spec.ts` | 19 | 0 | 0.1 | 0.0 | 0.0 | 0.0 |
| Sum | 867 | 1057 | 1033 | 782 | 746 | 475 |

### Nx processes of the slowest files and what one costs

Before any change (`c9da563`, 817 tests, 957 Nx processes, a single run at load 1 to 8: 239 s wall, files summed to 718 s, of which 701 s inside Nx processes):

- `cache-keys.spec.ts`: 163 hash calls at 619 ms each;
- `executors.spec.ts`: 41 `nx run` at 1066 ms, 13 `nx run-many` at 2267 ms, 1 graph call;
- `unknown-options.spec.ts`: 33 `nx run` at 1399 ms, 11 `nx run-many` at 1463 ms, 1 `nx affected`, 2 `nx daemon --stop`;
- `lockfile-runs.spec.ts`: 24 `nx run` at 1110 ms, 18 `nx run-many` at 1375 ms, 4 `nx affected`;
- `lockfile-keys.spec.ts`: 33 `nx run-many` at 933 ms, 30 hash calls at 590 ms.

Mean per kind of process over the whole run, before and after both changes (single runs at 22:23 and 22:37, same 957 processes):

| Process | Count | Before | After |
| --- | --: | --: | --: |
| graph call | 311 | 514 ms | 231 ms |
| hash call | 195 | 614 ms | 307 ms |
| `nx run` | 196 | 1074 ms | 694 ms |
| `nx run-many` | 81 | 1337 ms | 802 ms |
| `nx show` | 87 | 564 ms | 276 ms |
| `nx g` | 58 | 656 ms | 249 ms |
| `nx affected` | 14 | 964 ms | 475 ms |

One process in `subfolder-workspace`, median of five; the source columns and the compiled columns come from two runs a few minutes apart:

| Call | Workers, source | Nx's process, source | Workers, compiled | Nx's process, compiled |
| --- | --: | --: | --: | --: |
| graph | 488 ms | 249 ms | 339 ms | 136 ms |
| hash of two tasks | 517 ms | 288 ms | 377 ms | 164 ms |
| `nx show projects` | 518 ms | 269 ms | 380 ms | 161 ms |
| `nx run model:check --skip-nx-cache` | 1079 ms | 898 ms | 615 ms | 451 ms |
| the same, a cache hit | 911 ms | 630 ms | 524 ms | 351 ms |

What is left of a short command: `NX_PERF_LOGGING` puts `createProjectGraphAsync` at 60 ms, of which the plugin's `createNodes`, with `cargo metadata`, is 43 ms; the rest of the 150 to 175 ms is starting Node (16 ms) and loading Nx. The cargo wrapper adds 17 ms per cargo call. An uncached `nx run model:check` (480 ms) spends about 150 ms on the graph, 120 ms on the lockfile task it depends on and 50 ms in cargo; the rest is Nx's task runner and the tasks' processes. `--enable-source-maps` cost nothing measurable.

## Decisions

- **Plugins in Nx's process.** Set in the environment of `FixtureWorkspace` (`pluginsInNxProcess`), not in `testEnvironment()`: the end-to-end tests use `testEnvironment()` as well, one of them sets `NX_DAEMON` after calling it, and they should run as a repository that installs the plugin. In the installed Nx 24.0.6 the variable is read only in `project-graph/plugins/get-plugins.js` (in-process or worker) and in `loaded-nx-plugin.js`, which wraps `process.env` around `preTasksExecution` for a worker or the daemon so that the hook's changes reach the `nx` process; in-process the hook changes it directly. Commands with `NX_DAEMON=true` keep the default. The cases that keep Nx's default mode through `pluginWorkers` are the "without the daemon" cases of `cargo-directories`, `compatibility` (two, one of them "in a plugin worker"), `run-arguments` (three), `lockfile-runs` (two) and `unknown-options`; the tests that compare isolation on and off already set the variable (`configuration`, `discovery`, `graph`, `caching`, `compatibility`, `unknown-options`). Alone it saved 39% of the CPU time.
- **Compiled plugin.** Chosen, but compiled by the unit tests' global setup into the test run's folder (`compilePlugin`), not by making `test` depend on `build`. A `dist` from `nx build` would be stale or missing whenever Jest starts outside Nx (an editor, watch mode, `jest` in `nx-rust`), and the build's target ES2015 turns async functions into generators, whose stack traces lose the function names. The setup runs `tsc --noCheck` with `tsconfig.lib.json`, target ES2021 and inline source maps, as Nx compiles the source today, in a child process: about a second, and Jest's main process stays 5 MB larger, where compiling through the TypeScript API in it left 250 MB. The fixtures' commands run with `--enable-source-maps`: a plugin error's trace names `nx-rust/src/graph/plugin-version.ts`. The Mara code links are not affected: the markers stay in the source that `scip-typescript` indexes, and no test reads the copy's comments. A source that does not parse fails the setup with tsc's message; a type error does not, as with swc today. Alone it saved 23% of the CPU time; together with the first change 61%.
- **Executor called directly: not done.** A direct call still needs a graph process and the cargo call, so it would save at most the task runner's part, about 250 ms a run, on the 54 Nx runs of `executors.spec.ts`, not all of which only check a command: at most about 13 s of the 475 s. It would also bypass what those runs exercise: Nx's parsing of the command-line options (`--features=extra`, `--allFeatures`), `dependsOn` and the lockfile task, and `preTasksExecution`.
- **Fewer processes per test: not done.** Every test already makes one call per state except 17 in `target-defaults.spec.ts`, which run `nx show projects` for its output and a graph call for the merged projects on the same state, about 4 s in all. Merging them would replace the output of the real command with that of the harness. The cache-key rows hash each state once, and the environment row hashes its base once.
- **Not tried.** A long-lived helper process that keeps Nx's state (excluded unless proven; the remaining cost per process is mostly Node and Nx loading, which only such a process would avoid). A cargo wrapper without Node: 17 ms per call.


## Summary of Changes

- The unit tests' global setup compiles the plugin with `tsc --noCheck` into the test run's folder (`nx-rust/test/harness/compiled-plugin.ts`), as Nx compiled the source (ES2021, inline source maps), and every fixture copy loads that copy; the fixtures' commands enable source maps.
- The fixture copies' commands, graph calls and hash calls load the plugins into Nx's own process unless a command sets `NX_ISOLATE_PLUGINS` or `NX_DAEMON=true` (`pluginsInNxProcess` in `nx-rust/test/harness/workspace.ts`). The "without the daemon" cases of `cargo-directories`, `compatibility`, `run-arguments`, `lockfile-runs` and `unknown-options` pass `pluginWorkers` and keep Nx's default mode.
- `target-defaults` and `vendored-sources` name `pluginEntry()` in `nx.json`. `nx-rust/test/README.md` describes both changes.
- Every variant ran the same 867 tests with the same names on 2765657; merged with 6b09a45 the suite has 893 passing tests and 1 todo.

Checks run on the final state, merged with `origin/main` at 6b09a45: `pnpm nx run-many -t build lint test --skip-nx-cache` passed (30 suites, 893 tests passed, 1 todo), `pnpm nx format:check --all` passed, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` passed (30 tests), `mara schema validate` and `mara project validate` reported valid, and `zban check` passed. CI on pull request #58 covers what is left: the duration of its step `pnpm nx run-many -t build lint test` against 10m41s on `main`.

Rejected approaches: a `test` target that depends on `build` (a stale `dist` whenever Jest starts outside Nx, and ES2015 stack traces without function names); compiling through the TypeScript API inside Jest's main process (250 MB more for the whole run); calling executors directly; merging the `nx show projects` and graph calls of `target-defaults`; a long-lived helper process.
