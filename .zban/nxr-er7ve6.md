---
title: Running the test suites in several checkouts exhausts the machine's memory
status: in-progress
type: bug
tags:
  - tests
created_at: 2026-11-13T18:52:52Z
---

Goal: several checkouts on one machine can run the unit and end-to-end suites side by side without exhausting its memory, and a run leaves nothing on the RAM-backed `/tmp` that grows with the number of runs.

Found on 13 November 2026 on a development machine with 32 cores, 14 GB of RAM and `/tmp` on a RAM-backed disk of 7.5 GB, with Nx 24.0.6:

- `systemd-oomd` killed other agents' process groups twice within three minutes while several checkouts ran the suites (`journalctl` at 19:44 and 19:47 CET).
- The unit tests (`nx-rust/jest.config.cts`, preset `jest.preset.js`) set no `maxWorkers`, so Jest starts one worker per core but one, 31 workers of about 250 MB each: one run held about 7 GB in one checkout.
- Nx copies its 28 MB native binary into `<Nx's user temporary folder>/native-cache/<nx version>/<hash>-nx.linux-x64-gnu.node` once per workspace root (`node_modules/nx/dist/src/native/native-file-cache-location.js`, `node_modules/nx/dist/src/utils/nx-tmp-dir.js`), and that folder is `/tmp/.nx/<uid>/`, not `$TMPDIR`. The tests create fixture workspaces in random folders, so every fixture leaves a copy. After 2.5 hours of uptime `/tmp/.nx/1000/native-cache` held 3.9 GB (folders `24.0.6`, `23.4.2`, `25.0.0` and `not-a-version`, the last three from the tests that fake an Nx version), `/tmp/.nx/1000/compile-cache` 1.3 GB and `/tmp/.nx/1000/sockets` 22,500 stale entries.
- The installed Nx reads `NX_NATIVE_FILE_CACHE_DIRECTORY`, `NX_SKIP_NATIVE_FILE_CACHE`, `NX_TMP_DIR`, `NX_USER_TMP_DIR`, `NX_HOME_TMP_DIR` and `NX_SOCKET_DIR`.
- Pull request #44 (nxr-v4pd1t) adds `DISABLE_V8_COMPILE_CACHE=1` to `nx-rust/test/harness/environment.ts` for a related reason; keep both once it lands.

This concerns the tests' environment only, not how the plugin runs for users. What is in `/tmp/.nx/1000` now belongs to other processes and stays; the maintainer decides about it.

- [ ] Cap the unit tests' Jest workers in the repository's configuration, at a number that keeps one run well under 2 GB on this machine and does not slow CI (on a small runner Jest's default is already below the cap); measure one full run's peak memory before and after and record both here
- [ ] Make the unit-test harness and the end-to-end setup keep what Nx writes for fixture and test workspaces off the RAM-backed `/tmp` and leave nothing behind that grows with the number of runs: no native-binary copy per fixture, or one shared location under the disk-backed temporary folder (`os.tmpdir()`, which follows `$TMPDIR`), with the fixtures' own folders removed as today; sockets stay in a path under 108 bytes, such as the default or `$XDG_RUNTIME_DIR`, and the harness leaves no stale ones where it can avoid it
- [ ] Show the effect: the size of `/tmp/.nx/<uid>` and of the chosen location before and after one full unit run and one end-to-end run

Done when: the measurements are recorded here, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e --skip-nx-cache` pass.
