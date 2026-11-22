---
title: "Split executors/group-run.ts: output capture and nextest selection into modules of their own"
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-mdpha2
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:32Z
---

Goal: `nx-rust/src/executors/group-run.ts` holds the running of a group's steps, with the capture of a child's output and the nextest selection beside it. No behaviour changes (`DES-BATCH`).

Context: finding 10 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: split. The file is past 800 lines and holds three concerns. `runCaptured`, `LineForwarder` and `writeStderr` (about lines 664-803) capture and forward a child's output; `selectAffected`, `withoutFiltersets`, `selectionLine` and `listNextestTests` (442-590) are the nextest selection. `readRecords` and `removeRecord` (608-649) belong to the selecting runner of `cargo test`, not to nextest, and stay.

- [ ] Move the capture code into `nx-rust/src/executors/group-capture.ts` and the nextest selection into `nx-rust/src/executors/nextest-group.ts`
- [ ] Move code only; keep the `// @mara implements` markers and compare the code links before and after

Done when: the specs pass unchanged, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.

Added by the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3): `nx-rust/src/executors/group-run.ts` is 818 lines after nxr-tjxcvx and nxr-w1qhmx, and `readStep` now also carries the denied-warnings setting. The workers of both issues suggested a further cut: the step readers (`readStep`, `sharedOutcomes`, `hasLibrary`, `listNextestTests`) into `step-readers.ts`, leaving `runGroup` and its checks. Weigh it beside the two cuts above, after nxr-e4wynf has shared the readers' matchers and messages.
