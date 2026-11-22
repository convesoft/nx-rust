---
title: Name the cause where denied warnings stop the doctest step of a whole-workspace run
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-e4wynf
related:
  - nxr-hwkc7z
discovered_from: nxr-w1qhmx
created_at: 2026-11-22T16:50:46Z
---

Cites: `DES-TEST-RUN`, `REQ-BATCHING`.

Finding 2 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). nxr-w1qhmx made the build step, the `-p` test and doctest steps and the nextest build name the crates with warnings and the setting where Cargo denies warnings; `DES-TEST-RUN` ("Denied warnings in a test step") says that a later step of a whole-workspace run keeps the general message. The audit found where that later step is the first to compile: under `workspace-build`, the doctest step (`readDoctestStep` in `nx-rust/src/executors/test-steps.ts`, called from `group-run.ts`) where nextest with affected tests has nothing to run, and a warning under `#[cfg(doctest)]`, which `cargo test --workspace --no-run` does not compile. The tasks fail as they should; the message is the general one and the warnings of crates outside the group are dropped from the output.

Wave: behavior, after the shared stopped-step message (nxr-e4wynf).

- [ ] Reproduce with a real cargo: a warning that only the doctest step compiles, with warnings denied, in a whole-workspace run
- [ ] Give `readDoctestStep` the same reading of cargo's denial and the same message as the other steps, and update `DES-TEST-RUN` and its verification
- [ ] Test it with a real cargo on Cargo stable and 1.91

Done when: the reproduction names the crates and the setting, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, the Mara validation and `zban check` pass.
