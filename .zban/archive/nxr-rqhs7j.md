---
title: Test the build input check in one staged group of several crates
status: done
type: task
parent: nxr-e2z8sz
discovered_from: nxr-ffjvc9
created_at: 2026-11-21T16:42:41Z
closed_at: 2026-11-21T17:01:07Z
---

Goal: the build input check is tested in one staged `cargo build --workspace` group of several crates, through the real Nx batch runner and hasher (`DES-BUILD-INPUT-CHECK`, `VER-BUILD-INPUT-CHECK` or the item that verifies it, `GOAL-TRUSTED-CACHE`). No `VER-` item changes its meaning.

Context: found in nxr-ffjvc9. `main` checks that a check sees what its own cargo call wrote only in `nx-rust/test/build-input-check-listing.spec.ts`, with two groups of one crate each, selected with `-p`. Nothing checks the path that a whole-workspace `build` takes since nxr-yfh7zh: the files move out of the stage, Nx's workspace context is reset, and then the checks of every crate of the group run. The worker of nxr-ffjvc9 wrote such a test for the shared inspector that was not kept. The test is in commit 14c0e87 (branch `kept/nxr-ffjvc9-shared-inspector`), in `nx-rust/test/build-input-check.spec.ts`, block "in a group of several crates"; it also counts initializations of the inspector, which belongs to the dropped change.

- [x] Bring that test over without the count of initializations and without the variable `NX_RUST_TEST_INSPECTOR_LOG`: in one staged group of three crates (reader, base, plain), the check fails `plain` for an undeclared file that its build script wrote during that cargo call, and passes `base` and `reader` for a file that `base`'s build script wrote into `base`'s folder and that its library includes, which `reader`'s record names too
- [x] Show with a temporary change that the test fails when the check reads a state from before the group's cargo call (for example with the reset of the workspace context taken out), and say so in the summary
- [x] If the verification item names what its tests run, add the case in one clause

Done when: the test passes and fails under the temporary change, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/test/build-input-check.spec.ts`: new case "fails, in one staged group, the crate whose build script wrote an undeclared file in the group's cargo call, and passes those whose included file it wrote into a declared folder", taken from 14c0e87 without the inspector count and without `NX_RUST_TEST_INSPECTOR_LOG`, plus its `buildScript` helper. One `cargo build --workspace` for reader, base and plain; only `plain:build` fails, listing `gen/plain/new.txt`; base and reader pass, and both records name `rust/crates/base/generated/value.txt`.
- `VER-` item in `verification.mara.md` (the batch paragraph of the build input check): one clause for the staged whole-workspace group of three crates.
- Temporary change (not committed; `git diff main -- nx-rust/src` is empty): commenting out only `resetNxWorkspaceContext` in `group-run.ts` leaves the test passing, because in a single group nothing in the batch process reads Nx's workspace context before the cargo call, so the reset has nothing to clear (as the comment in `task.ts` says for Nx 24.0.6). With the context also read (`globWithWorkspaceContextSync`) at the start of `runGroup`, before cargo, and the reset removed, so that the check reads the state from before the call, the test fails at `expect(failedTasks(output)).toEqual(["plain:build"])`: received `["base:build", "reader:build"]`.

Checks run: the new case alone (passes; fails under the temporary change above), `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`, after merging `main`.

## Decisions made

- Kept the case in `build-input-check.spec.ts` beside the other group cases instead of a new spec: it reuses about ten helpers of that file, which a separate spec would have to copy or move. The split is suggested as follow-up work instead.
- The second item counts as met with a temporary change that both reads the context before the cargo call and drops the reset: dropping the reset alone does not make a single group's check read stale state.
