---
title: Test the build input check in one staged group of several crates
status: in-progress
type: task
parent: nxr-e2z8sz
discovered_from: nxr-ffjvc9
created_at: 2026-11-21T16:42:41Z
---

Goal: the build input check is tested in one staged `cargo build --workspace` group of several crates, through the real Nx batch runner and hasher (`DES-BUILD-INPUT-CHECK`, `VER-BUILD-INPUT-CHECK` or the item that verifies it, `GOAL-TRUSTED-CACHE`). No `VER-` item changes its meaning.

Context: found in nxr-ffjvc9. `main` checks that a check sees what its own cargo call wrote only in `nx-rust/test/build-input-check-listing.spec.ts`, with two groups of one crate each, selected with `-p`. Nothing checks the path that a whole-workspace `build` takes since nxr-yfh7zh: the files move out of the stage, Nx's workspace context is reset, and then the checks of every crate of the group run. The worker of nxr-ffjvc9 wrote such a test for the shared inspector that was not kept. The test is in commit 14c0e87 (branch `kept/nxr-ffjvc9-shared-inspector`), in `nx-rust/test/build-input-check.spec.ts`, block "in a group of several crates"; it also counts initializations of the inspector, which belongs to the dropped change.

- [ ] Bring that test over without the count of initializations and without the variable `NX_RUST_TEST_INSPECTOR_LOG`: in one staged group of three crates (reader, base, plain), the check fails `plain` for an undeclared file that its build script wrote during that cargo call, and passes `base` and `reader` for a file that `base`'s build script wrote into `base`'s folder and that its library includes, which `reader`'s record names too
- [ ] Show with a temporary change that the test fails when the check reads a state from before the group's cargo call (for example with the reset of the workspace context taken out), and say so in the summary
- [ ] If the verification item names what its tests run, add the case in one clause

Done when: the test passes and fails under the temporary change, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
