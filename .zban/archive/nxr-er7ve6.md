---
title: Running the test suites in several checkouts exhausts the machine's memory
status: done
type: bug
tags:
  - tests
created_at: 2026-11-13T18:52:52Z
closed_at: 2026-11-13T19:50:57Z
---

Goal: several checkouts on one machine can run the unit and end-to-end suites side by side without exhausting its memory, and a run leaves nothing on the RAM-backed `/tmp` that grows with the number of runs.

Found on 13 November 2026 on a development machine with 32 cores, 14 GB of RAM and `/tmp` on a RAM-backed disk of 7.5 GB, with Nx 24.0.6:

- `systemd-oomd` killed other agents' process groups twice within three minutes while several checkouts ran the suites (`journalctl` at 19:44 and 19:47 CET).
- The unit tests (`nx-rust/jest.config.cts`, preset `jest.preset.js`) set no `maxWorkers`, so Jest starts one worker per core but one, 31 workers of about 250 MB each: one run held about 7 GB in one checkout.
- Nx copies its 28 MB native binary into `<Nx's user temporary folder>/native-cache/<nx version>/<hash>-nx.linux-x64-gnu.node` once per workspace root (`node_modules/nx/dist/src/native/native-file-cache-location.js`, `node_modules/nx/dist/src/utils/nx-tmp-dir.js`), and that folder is `/tmp/.nx/<uid>/`, not `$TMPDIR`. The tests create fixture workspaces in random folders, so every fixture leaves a copy. After 2.5 hours of uptime `/tmp/.nx/1000/native-cache` held 3.9 GB (folders `24.0.6`, `23.4.2`, `25.0.0` and `not-a-version`, the last three from the tests that fake an Nx version), `/tmp/.nx/1000/compile-cache` 1.3 GB and `/tmp/.nx/1000/sockets` 22,500 stale entries.
- The installed Nx reads `NX_NATIVE_FILE_CACHE_DIRECTORY`, `NX_SKIP_NATIVE_FILE_CACHE`, `NX_TMP_DIR`, `NX_USER_TMP_DIR`, `NX_HOME_TMP_DIR` and `NX_SOCKET_DIR`.
- Pull request #44 (nxr-v4pd1t) adds `DISABLE_V8_COMPILE_CACHE=1` to `nx-rust/test/harness/environment.ts` for a related reason; keep both once it lands.

This concerns the tests' environment only, not how the plugin runs for users. What is in `/tmp/.nx/1000` now belongs to other processes and stays; the maintainer decides about it.

- [x] Cap the unit tests' Jest workers in the repository's configuration, at a number that keeps one run well under 2 GB on this machine and does not slow CI (on a small runner Jest's default is already below the cap); measure one full run's peak memory before and after and record both here
- [x] Make the unit-test harness and the end-to-end setup keep what Nx writes for fixture and test workspaces off the RAM-backed `/tmp` and leave nothing behind that grows with the number of runs: no native-binary copy per fixture, or one shared location under the disk-backed temporary folder (`os.tmpdir()`, which follows `$TMPDIR`), with the fixtures' own folders removed as today; sockets stay in a path under 108 bytes, such as the default or `$XDG_RUNTIME_DIR`, and the harness leaves no stale ones where it can avoid it
- [x] Show the effect: the size of `/tmp/.nx/<uid>` and of the chosen location before and after one full unit run and one end-to-end run

Done when: the measurements are recorded here, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e --skip-nx-cache` pass.

## Summary of Changes

- `nx-rust/jest.config.cts` caps the unit tests at three Jest workers, or Jest's own default of one per core but one where that is lower. CI's runner (4 vCPUs, GitHub's standard runner for public repositories) already got three, so CI runs as before. A command-line `--maxWorkers` still wins.
- `testEnvironment()` (`nx-rust/test/harness/environment.ts`), which every fixture and test-project command gets, sets `NX_SKIP_NATIVE_FILE_CACHE=true`, so that Nx loads its native binary where it is installed, and points Node's compile cache (`NODE_COMPILE_CACHE`) at the test run's folder, or turns it off (`NX_COMPILE_CACHE=false`) without one. It keeps `DISABLE_V8_COMPILE_CACHE=1` from nxr-v4pd1t.
- `nx-rust/test/harness/test-run.ts` (new): `startTestRun()` and `endTestRun()`, called by the unit tests' new global setup and teardown and by the end-to-end global setup and teardown, create and remove one folder per run in the temporary folder (`os.tmpdir()`) and one in `XDG_RUNTIME_DIR` where there is one.
- `FixtureWorkspace` gives each copy's Nx a socket folder of its own (`NX_SOCKET_DIR`) inside the run's socket folder, about 60 bytes long, and `remove()` deletes it. Without a test run Nx uses its default.
- The end-to-end test project's `pnpm install` gets `testEnvironment()` too: Nx's postinstall loads Nx and copied its binary into `/tmp/.nx`.
- `fixture-workspace.spec.ts` checks that a failed `create` removes every folder it made; `nx-rust/test/README.md` describes the test run, the caches and the worker cap.

Why these settings, measured on 13 November 2026 with Nx 24.0.6 and Node 26.12:

- The native-binary copies are made once per checkout and Nx version, not per fixture: Nx names a copy after a hash of the binary's resolved path, which every fixture of a checkout shares, also the ones with a fake Nx. With dozens of checkouts and four Nx versions per checkout, they added up. Loading the binary in place cost nothing measurable (`nx show projects` in a fixture: median 424 ms either way).
- Node's compile cache is keyed by file path, so each fixture with a fake Nx added entries for all of Nx's modules (5.7 MB per fixture). Turning it off cost 150 ms per Nx command (575 ms against 424 ms warm), a cache per fixture 200 ms on each fixture's first command; a cache per run is warm after the first commands and leaves nothing.
- Nx names its default socket folder after the workspace root and never removes it; with a fixture's own `NX_SOCKET_DIR`, Nx's resolver showed no default folder left for a fixture that ran plugin workers and a daemon, and one left without it. A plugin worker can still write into a fixture's socket folder while `remove()` deletes it (1 to 7 per full run), which is why the run's folder is removed at the end (nxr-cebww0).

Memory: the peak anonymous memory of all processes of one `pnpm nx test @convesoft/nx-rust` run, in a cgroup of its own, sampled every 0.5 s.

- Before, uncapped (31 workers): not measured again. `free -g` showed 3 GB available, so the 7 GB observed on 13 November stands.
- The old configuration at `--maxWorkers=6`: 3,714 MiB, 138 s.
- With the cap of three: 2,339, 2,443 and 2,630 MiB in three runs, 176 to 258 s depending on the machine's load. The peak comes about 4 s into the run: three Jest workers of 362 to 415 MiB, Jest's main process of about 330 MiB, the outer Nx of about 180 MiB and the fixtures' Nx processes of 170 to 210 MiB each. The Jest workers held about 1.1 GB at the peak; the whole run is above 2 GB, which fewer workers would fix only by slowing CI (nxr-2bdrk4).

`/tmp/.nx/1000` and the chosen locations, before and after each run. Other checkouts ran the old harness at the same time, so the totals also move with their writes; a native copy is attributed by the hash in its name. Between the runs before and after the change, someone else cleared most of `/tmp/.nx/1000`, and the shell environment began setting `NX_NATIVE_FILE_CACHE_DIRECTORY` and `NODE_COMPILE_CACHE` to folders in `~/.tmp/claude`. The harness passes no `NX_` variable to its commands and sets its own `NODE_COMPILE_CACHE`, so those settings reached the outer Nx only.

| Run | native-cache | compile-cache | socket folders | Run folder in `$TMPDIR` | Run socket folder |
| --- | --- | --- | --- | --- | --- |
| Unit, old harness, 6 workers (20:05 to 20:07) | 4.1 to 4.2 GB, with 2 new copies of this checkout's (23.4.2, not-a-version) | 1.3 to 1.4 GB, 3,585 entries more | 23,907 to 24,504 | none | none |
| Unit, new harness (20:35 to 20:40) | 296 to 322 MB, no copy of this checkout's | 3.4 MB and 715 entries before and after, none changed | 27,858 to 28,558, all from other checkouts | at most 28 MiB (4,871 files), removed at the end | at most 3 fixture folders, removed at the end |
| End-to-end, new harness (20:42 to 20:43) | 349 to 403 MB, no copy of this checkout's or of the test project's | 3.4 MB and 715 entries before and after | 28,647 to 28,665 | at most 7 MiB (1,337 files), removed | removed |

The end-to-end test project keeps Nx's default socket folder, one per checkout, which later runs reuse.

Checks run, on the branch with `origin/main` at c34eb22 merged in:

- `pnpm nx run-many -t build lint test`: 24 suites, 731 tests passed.
- `pnpm nx format:check --all`: passed.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 tests passed.
- `mara schema validate` and `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`.

Filed: nxr-eav6mm (the daemon tests make Nx download `nx@latest` into `~/.nx/tmp`), nxr-2bdrk4 (a run still peaks above 2 GB), nxr-cebww0 (something writes into a fixture's socket folder after a failed graph creation).

Not changed: the repository's own Nx still copies its binary into `/tmp/.nx/<uid>` once per checkout, as Nx does for any workspace. What was in `/tmp/.nx/1000` before stays; only five empty socket folders that probes of this work had created there were removed.
