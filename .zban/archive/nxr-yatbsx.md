---
title: Run target-defaults cases once and in plugin workers only at process boundaries, and use nx add only where it is what the end-to-end test checks
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-w6117m
  - nxr-qkxcmm
  - nxr-h411yj
  - nxr-1tmme6
  - nxr-ryhjf1
created_at: 2026-11-20T16:38:45Z
closed_at: 2026-11-21T16:22:57Z
---

Goal: `target-defaults.spec.ts` and the `nx add` part of the end-to-end suite stop repeating runs that prove nothing more, with `VER-TARGET-DEFAULT-GUARD` and `VER-SETUP` changed to say exactly what is still run.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/target-defaults.spec.ts` took 75.0 s for 159 tests. The maintainer approved these two changes of verification items in that audit (thread "Review and speed up nx-rust test suite", 20 November 2026); they need no further confirmation, and nothing beyond them is approved. The issue waits for the issues that change `target-defaults.ts`, the end-to-end spec and the verification page.

- [x] `target-defaults.spec.ts` lines 118-130: `created()` spawns two Nx processes (`nx show projects` and `workspace.graph()`) on the same unchanged workspace, more than 13 times. Make it one invocation that yields both the output of graph creation and the merged projects
- [x] `target-defaults.spec.ts` lines 83-86: 29 tests run under `it.each(pluginModes)`, about 1.1 s more for each run with plugin workers. Keep plugin-worker runs for the 6 to 8 tests that cover each boundary between processes (a failing guard, a warning guard, `extends`, the plugin before and after another in the order, and the handing over from `createNodes` to `createDependencies`), and run the permutations of rules and messages in Nx's own process. Update `VER-TARGET-DEFAULT-GUARD` (`nx-rust/docs/verification.mara.md`) to name what runs in which mode
- [x] `nx-rust-e2e/src/nx-rust.spec.ts` lines 1090-1172: keep the real `nx add @convesoft/nx-rust@e2e` for the first install (line 115), for the `build` default and its idempotency (lines 1093 and 1110) and for the failing `nx add` (line 1163), so that failure handling of `nx add` stays covered. Run the two middle `targetDefaults` variants (lines 1117 and 1131) with `nx g @convesoft/nx-rust:init`, since the plugin is installed in that project by then. Update the sentence of `VER-SETUP` that describes them
- [x] Show that the remaining plugin-worker tests still fail when the guard's state does not cross the process boundary, and give the timings before and after

Done when: both suites pass, the two verification items agree with what runs, the Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/test/harness/workspace.ts`: new `FixtureWorkspace.graphWithOutput(env)`. It returns the arranged graph and what graph creation printed, from one run of `inspect-workspace.cjs`, and `graph()` now delegates to it. In `target-defaults.spec.ts`, `created()` and the new `createdWith(env, ...files)` use it, and so does every other case that ran `nx show projects` and then `workspace.graph()` on the same files. Each of those now starts one Nx process instead of two.
- `target-defaults.spec.ts`: every case runs with the plugin in Nx's own process. The only exception is the case where Cargo's configuration picks a triple: it runs in a worker alone, as before. Only the cases that cross a process boundary also run in a worker:
  - the entry filtered to a plugin listed before nx-rust;
  - the entry filtered to the tag `extra` where the Cargo metadata leaves `check` uncached;
  - the warning beside a plugin that tags `api`;
  - the plugin listed after nx-rust that replaces the inputs of `check`, without `targetDefaults`.

  The worker case for `extends` stays in `warnings.spec.ts`. The other 41 worker runs, which were permutations of rules and messages, now run in Nx's own process alone. No rule, message, case or assertion was dropped.
- `nx-rust-e2e/src/nx-rust.spec.ts`: the two middle `targetDefaults` variants (entries keyed by other executors only, and the warning entry keyed by `@convesoft/nx-rust:cargo`) now run `nx g @convesoft/nx-rust:init` through the installed Nx, not `nx add`. Nx 24.0.6's `nx add` calls `runPluginInitGenerator` (`dist/src/command-line/init/configure-plugins.js`). That runs `nx g <plugin>:init` and adds `--keepExistingVersions` or `--updatePackageScripts` only when the schema declares them, and the latter only for Nx's core plugins. The init schema declares no options, so both paths run the same generator with the same options. On top of that, `nx add` stops a live daemon, installs the package with `pnpm add -D` (acknowledging build scripts), turns a failing init into "Failed to initialize" with exit 1, and prints "Package added successfully". The remaining `nx add` cases assert the install (the first `nx add` and the files it changes), that a second `nx add` writes nothing, and the failing `nx add`'s exit status 1 with init's error message and "nx.json is unchanged.". They do not assert the wrapper's success line, its "Failed to initialize" heading, or the stopping of a live daemon.
- `VER-TARGET-DEFAULT-GUARD` names which cases run in which plugin mode and marks the worker cases "in both modes". The `VER-SETUP` sentence about the `targetDefaults` variants of `nx add` says that the two middle variants run the init generator. These are the two changes approved on 20 November 2026.

Evidence (a temporary change in `nx-rust/src/index.ts`, not committed, active only where `globalThis.NX_PLUGIN_WORKER` is set). In each run, the twins in Nx's own process passed:
- Failing guard (the error dropped in the worker): the worker runs of the plugin-before, tag/uncached-check and plugin-after cases failed, and so did the triple case.
- Warning guard (`console.warn` dropped in the worker): the tagger warning case failed in the worker.
- `extends` (the worker reads raw `nx.json` instead of Nx's resolved one): the `warnings.spec.ts` case for an entry in the extended file, filtered to a plugin before nx-rust, failed in the worker.
- Plugin before (plugins listed before nx-rust dropped from `nx.json` in the worker): the plugin-before case failed in the worker, and so did the `extends` case, which is filtered to a plugin before.
- Plugin after (plugins listed after dropped): the plugin-after case failed in the worker.
- Hand-over from `createNodes` to `createDependencies` (no record in the worker): every kept worker run failed (all 6).

Timings, each measured alone with `--skip-nx-cache`:
- `target-defaults.spec.ts`: 159 tests in 80.0 s before, 118 tests in 32.3 s after (Jest time).
- End-to-end suite: 27 tests, 37.3 s before and 28.6 s after (Jest time); Nx run 47.4 s before and 37.4 s after.

Checks run:
- `pnpm nx run-many -t build lint test`: passed, 80 suites, 2087 tests, no `fetch failed` in `sparse-registry.spec.ts`.
- `pnpm nx e2e nx-rust-e2e`: passed, 27 tests.
- The same on Cargo 1.91.0 with a private `RUSTUP_HOME`: passed, 27 tests; that rustup home was deleted.
- `pnpm nx format:check --all`: passed.
- `mara schema validate`: valid.
- `mara project validate`: valid, evaluation complete, 0 errors, 0 warnings.
- `zban check`: run at commit.

`target-defaults.spec.ts` sets no `CI` or agent variables itself, so the CI-mode run was not needed.

## Decisions made

- The single invocation runs through the harness's `inspect-workspace.cjs` (`graphWithOutput`), not `nx graph --file`. On a failed graph, `nx graph` shows a partial graph instead of failing, and it computes affected projects as well.
- The worker runs kept in `target-defaults.spec.ts` are the five named above. The `extends` boundary keeps its existing worker case in `warnings.spec.ts`.
- The cases that write out the dependency on the lockfile task now run in Nx's own process alone. The placeholders of EVD-NX-24-PLUGIN-NODES reach the plugin's record only there, and a plugin in a worker hands Nx a copy. The rename cases also run in Nx's own process alone, since the plugin now hands Nx a copy in both modes. EVD-NX-24-PLUGIN-NODES ("The guard") now dates its runs in both modes and says so.
- Accepted by the orchestrator after the review: the converted cases no longer assert the exit status of a separate `nx show projects` run, since one process now yields the graph and what graph creation printed, and a failure of that process fails the case.
- Accepted by the orchestrator after the review: a regression that exists only in a plugin worker for an explicit lockfile dependency, a renamed project reference or a later plugin's named inputs would not be caught. This is the reduction that the maintainer approved.
