---
title: Find why "locked mode › passes --locked as it says by default" failed once with perf:fmt-check
status: done
type: bug
discovered_from: nxr-9ezy43
created_at: 2026-11-13T17:32:01Z
closed_at: 2026-11-13T18:37:41Z
---

Goal: `nx-rust/test/executors.spec.ts` passes reliably, or a real fault in `fmt-check` is fixed.

On 2026-11-13, in a full `pnpm nx run-many -t build lint test` at aad9754 (main at 0fab840 with the nxr-9ezy43 branch merged), "locked mode › passes --locked as it says by default" failed: the `nx run-many` over `perf`, `cli` and `rust` in `crate-shapes` listed `- perf:fmt-check` among the failed tasks, besides the expected `rust:audit` and `rust:deny` (`executors.spec.ts`, the `runAll` helper). The suite took 171 s, with other agents loading the machine. The same test passed twice right after, run alone with `-t "locked mode"`. The change under test does not touch `crate-shapes` (no `.cargo-checksum.json` there). The run starts `perf:fmt` and `perf:fmt-check` in one `nx run-many`; whether they interfere was not checked, and the output of the failed `fmt-check` was not kept.

- [x] Reproduce it, for example by running the test repeatedly under load, and keep the failed task's output
- [x] Fix the cause: the test, if `fmt` and `fmt-check` must not run together, or the plugin, if `fmt-check` fails where plain `cargo fmt --check` would not

Done when: the cause is known and fixed, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Cause: neither the plugin nor `fmt` running beside `fmt-check`. Node crashed in Nx's process for the task. In the fixture workspaces, Nx registers ts-node's ESM loader in every task process, because `require.resolve("@swc-node/register/esm")` fails (that export has only an `import` condition). ts-node loads TypeScript through v8-compile-cache-lib. That library keeps one BLOB/MAP pair per workspace root in `$TMPDIR/v8-compile-cache-<uid>/<v8>/`, because `require.main` is undefined in the loader-hooks worker. Every task process of a run reads the pair at start and then rewrites it in place. Writers take a lock; readers do not. A torn read hands V8 a cache whose header and payload come from different writes. In Node 26.12 V8 accepts such a cache and aborts.

Evidence:

- `coredumpctl` holds the original crash: 18:29:24 CET, three minutes before this issue was filed. It was `run-executor.js` with `NX_TASK_TARGET_PROJECT=perf` and `NX_TASK_TARGET_TARGET=fmt-check`, running `runAll`'s exact `run-many` command in a crate-shapes fixture. The process died on SIGTRAP after V8 printed `Check failed: current == end_slot_index.` (the deserializer). The core holds v8-compile-cache-lib and the fixture's BLOB, MAP and LOCK paths.
- Repeating the `run-many` 120 times (8 jobs at a time under extra CPU load) failed once, on `perf:build`, with the same V8 fatal error. No cargo call was logged, so cargo never started.
- A cache of `typescript.js` made from the start of one process's cache and the rest of another's makes Node abort with the same message. Caches from different processes differ in size and content.
- v8-compile-cache-lib on its own, 16 processes at a time sharing one cache folder under load: 3 crashes in 3,104 loads, one with the same message and two segfaults.
- Ruled out: `cargo fmt` leaves formatted files untouched (same inode and mtime). `fmt -p perf` and `fmt --check -p perf` started together 300 times never failed. All 16 cargo commands of the run started together 40 times never failed.

Fix: `testEnvironment()` sets `DISABLE_V8_COMPILE_CACHE=1` for every command that the harness runs. No cache file is then read or written for the fixtures. Under the same load, 120 more rounds of the `run-many` passed, and no Node process dumped core. The cache files that earlier test runs left behind are no longer added to. They took 13 GB in `$TMPDIR/v8-compile-cache-1000/` on the shared machine.

Checks run: `pnpm nx run-many -t build lint test` (4 tasks succeeded), `pnpm nx format:check --all`, `zban check`, `mara schema validate` and `mara project validate` (valid, evaluation complete). Not run: `pnpm nx e2e nx-rust-e2e`, because the built plugin did not change.
