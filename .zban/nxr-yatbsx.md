---
title: Run target-defaults cases once and in plugin workers only at process boundaries, and use nx add only where it is what the end-to-end test checks
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-w6117m
  - nxr-qkxcmm
  - nxr-h411yj
  - nxr-1tmme6
  - nxr-ryhjf1
created_at: 2026-11-20T16:38:45Z
---

Goal: `target-defaults.spec.ts` and the `nx add` part of the end-to-end suite stop repeating runs that prove nothing more, with `VER-TARGET-DEFAULT-GUARD` and `VER-SETUP` changed to say exactly what is still run.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/target-defaults.spec.ts` took 75.0 s for 159 tests. The maintainer approved these two changes of verification items in that audit (thread "Review and speed up nx-rust test suite", 20 November 2026); they need no further confirmation, and nothing beyond them is approved. The issue waits for the issues that change `target-defaults.ts`, the end-to-end spec and the verification page.

- [ ] `target-defaults.spec.ts` lines 118-130: `created()` spawns two Nx processes (`nx show projects` and `workspace.graph()`) on the same unchanged workspace, more than 13 times. Make it one invocation that yields both the output of graph creation and the merged projects
- [ ] `target-defaults.spec.ts` lines 83-86: 29 tests run under `it.each(pluginModes)`, about 1.1 s more for each run with plugin workers. Keep plugin-worker runs for the 6 to 8 tests that cover each boundary between processes (a failing guard, a warning guard, `extends`, the plugin before and after another in the order, and the handing over from `createNodes` to `createDependencies`), and run the permutations of rules and messages in Nx's own process. Update `VER-TARGET-DEFAULT-GUARD` (`nx-rust/docs/verification.mara.md`) to name what runs in which mode
- [ ] `nx-rust-e2e/src/nx-rust.spec.ts` lines 1090-1172: keep the real `nx add @convesoft/nx-rust@e2e` for the first install (line 115), for the `build` default and its idempotency (lines 1093 and 1110) and for the failing `nx add` (line 1163), so that failure handling of `nx add` stays covered. Run the two middle `targetDefaults` variants (lines 1117 and 1131) with `nx g @convesoft/nx-rust:init`, since the plugin is installed in that project by then. Update the sentence of `VER-SETUP` that describes them
- [ ] Show that the remaining plugin-worker tests still fail when the guard's state does not cross the process boundary, and give the timings before and after

Done when: both suites pass, the two verification items agree with what runs, the Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
