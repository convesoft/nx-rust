---
title: Find why "locked mode › passes --locked as it says by default" failed once with perf:fmt-check
status: todo
type: bug
discovered_from: nxr-9ezy43
created_at: 2026-11-13T17:32:01Z
---

Goal: `nx-rust/test/executors.spec.ts` passes reliably, or a real fault in `fmt-check` is fixed.

On 2026-11-13, in a full `pnpm nx run-many -t build lint test` at aad9754 (main at 0fab840 with the nxr-9ezy43 branch merged), "locked mode › passes --locked as it says by default" failed: the `nx run-many` over `perf`, `cli` and `rust` in `crate-shapes` listed `- perf:fmt-check` among the failed tasks, besides the expected `rust:audit` and `rust:deny` (`executors.spec.ts`, the `runAll` helper). The suite took 171 s, with other agents loading the machine. The same test passed twice right after, run alone with `-t "locked mode"`. The change under test does not touch `crate-shapes` (no `.cargo-checksum.json` there). The run starts `perf:fmt` and `perf:fmt-check` in one `nx run-many`; whether they interfere was not checked, and the output of the failed `fmt-check` was not kept.

- [ ] Reproduce it, for example by running the test repeatedly under load, and keep the failed task's output
- [ ] Fix the cause: the test, if `fmt` and `fmt-check` must not run together, or the plugin, if `fmt-check` fails where plain `cargo fmt --check` would not

Done when: the cause is known and fixed, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
