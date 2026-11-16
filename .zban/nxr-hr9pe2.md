---
title: The test suite sends core-dumping signals to real processes, so every run leaves crash records on the host
status: todo
type: bug
discovered_from: nxr-8f9dz2
created_at: 2026-11-16T18:12:51Z
---

Goal: a full run of the nx-rust test suites kills no real process with a signal whose default action dumps core, so that it leaves no record in `systemd-coredump`'s journal and sets off no crash notification on the host.

Context, reported by the maintainer on 16 November 2026: every run of the test-runner tests makes two core-dump records on the host, `/bin/sh killer.sh` and `node .../plugin/src/executors/test-runner.js`, both with SIGSEGV. The desktop's crash watcher follows `systemd-coredump`'s journal entries, so each run shows a "Process crashed" notification for bash and for node. It happened twice that day, at 18:54:19 (PIDs 3795424 and 3795401) and 18:54:26 (PIDs 3808704 and 3808673). The cause is deliberate, not a memory fault: both cores show a signal sent with `kill` (bash: `si_code=SI_USER`, stack in `kill_builtin`; node: `si_code=SI_TKILL`, stack in `uv_kill`, that is `process.kill(process.pid, ...)`). The fixture `killer.sh` of `nx-rust/test/test-steps.spec.ts` (about line 103) sends SIGSEGV to itself, and the selecting runner (`nx-rust/src/executors/test-runner.ts`, `DES-TEST-RUN`, "The selecting runner") then raises its child's death signal on itself. `ulimit -c 0` does not help: the core pattern is a pipe to `systemd-coredump`, which runs anyway and writes the journal entry; only the core file is skipped.

The maintainer's proposed fix:

- [ ] Unit-test the signal handling with a fake child: emit `exit(null, 'SIGSEGV')` from a fake child process, make the re-raise (`process.kill(process.pid, signal)`) a function that the test passes in, and assert that it was called with the right signal. No real signal is sent
- [ ] Keep one real test of the runner dying by its child's signal, with a signal that does not dump core: SIGTERM, SIGINT, SIGUSR1 or SIGKILL. No real process of the suite gets SEGV, ABRT, BUS, FPE, ILL, QUIT, TRAP or XFSZ
- [ ] Only if a real core-dumping signal is truly needed somewhere: the process clears its dumpable flag first (`prctl(PR_SET_DUMPABLE, 0)`), in the fixture and in the runner under test; the two items above are preferred
- [ ] Go through the whole suite, the end-to-end tests and the fixtures' Rust code for other real processes that die by such a signal (a fixture test that calls `std::process::abort()` or panics in a way that aborts, `kill -ABRT`, `process.abort()`), and treat them the same way

Done when: a full run of `pnpm nx run-many -t build lint test` and of `pnpm nx e2e nx-rust-e2e` adds nothing to `coredumpctl list --since <start of the run>`, and both pass.
