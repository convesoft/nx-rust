---
title: Read cargo's compile errors after forced progress text in the test steps
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-w1qhmx
created_at: 2026-11-22T16:11:09Z
---

Found while working on nxr-w1qhmx (22 Nov 2026, Cargo 1.100.0). Cites: `DES-BATCH` (its sentence on escape sequences in cargo's human-readable lines), `DES-TEST-RUN` ("What each task shows", "Denied warnings in a test step").

With `CARGO_TERM_PROGRESS_WHEN=always`, cargo writes its progress bar and a carriage return before the next line on the same line, also where its output is captured. The readers of the test steps match lines through `plainLine` (`nx-rust/src/executors/cargo-output.ts`), which removes escape sequences only, so such a line reads as a `Building` status line. nxr-w1qhmx leaves progress text out only for the lines of denied warnings (`deniedWarningsLine`), on purpose: dropping text before a carriage return everywhere let test output be read as cargo's lines.

Reproduction: copy `nx-rust/test/fixtures/workspace-tests/rust`, add `pub fn broken() -> u32 { missing }` to `crates/d/src/lib.rs`, and run `CARGO_TERM_PROGRESS_WHEN=always CARGO_TERM_PROGRESS_WIDTH=80 cargo test --workspace --no-run --offline`. Cargo printed `    Building [=>   ] 2/24: h(test), d, tool(bin test),…\rerror[E0425]: cannot find value `missing` in this scope` on one line; `error: could not compile `d` (lib) due to 1 previous error` came on a line of its own in that run, but in the review of nxr-w1qhmx cargo put a progress bar before an `error:` summary line as well, so it can presumably do so before `could not compile` too.

Consequences, by reading: in `attributeText` (`nx-rust/src/executors/test-steps.ts`) the error block of a crate outside the group then reads as a status line, not as an error, and is left out of every task's output; where `could not compile` itself carries the prefix, `notCompiled` misses the crate and the message falls back to the general one. No task passes that should fail.

- [ ] Reproduce through Nx with forced progress and a compile error in a crate outside the group
- [ ] Decide in `DES-BATCH` how progress bars before cargo's own lines are read without reading test output as cargo's lines (for example only where the text before the carriage return has the shape of cargo's progress bar, as `deniedWarningsLine` does), and implement it
