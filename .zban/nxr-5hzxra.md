---
title: Keep a cached task outside the plugin from storing what it made of the executable that a test batch linked in place of its build's
status: in-progress
type: bug
parent: nxr-e2z8sz
blocked_by:
  - nxr-h411yj
discovered_from: nxr-yfh7zh
created_at: 2026-11-20T16:32:35Z
---

Goal: a cached task that depends on a crate's `build` and reads its executable never stores a result made from the executable of `cargo test` (`GOAL-TRUSTED-CACHE`). The maintainer decided how (below).

Context: found while working on nxr-yfh7zh (`EVD-BATCH-FILES-ON-DISK`, fourth row of its table). In the `binary-tests` fixture, `cargo test` links `app` with the feature `extra` that its dev-dependency turns on, while `cargo build` leaves it off. A cached JS target `pack`, with `app` as an implicit dependency, the inputs `["default", "^default"]`, `dependsOn` on `app:build` (and on `app:test`, to fix the order) and the command `mkdir -p dist && ./rust/target/debug/app > dist/out.txt`, stores `extra` in `nx run-many -t build test pack -p app pack` with batching on (batching off was not run): Nx stores `app:build` before the `test` batch, the `test` batch links `app` again, and `pack` runs after it, so that a later `nx run pack:pack` would restore `extra` beside a restored `app` that prints `plain`, as in the build case of nxr-yfh7zh. With `dependsOn` on `app:build` only, whether `pack` runs before or after the `test` batch is up to Nx's order. The `build` entries themselves are right.

nxr-yfh7zh made each group of `build`, `napi-build` and `wasm-build` keep the files of the command's other cached builds and put them back after its commands (`DES-BATCH`, "Files that a batch leaves on disk"). The same mechanism applied to `test` and `bench` groups fixes this case: it was tried, `pack` stored `plain`. But afterwards the artifact directory holds the executable of `cargo build`, not of `cargo test`. That contradicts what the maintainer accepted with `ADR-TEST-AFTER-BUILD` on 14 November 2026 ("after a command that runs both, the artifact directory holds what cargo wrote last, the executable of `cargo test`, as plain `cargo build && cargo test` leaves it, while the cache entries are right"), and `VER-CARGO-UNCHANGED` and `VER-BATCHING` check it (9 tests in `batch-runs.spec.ts` and `test-after-build.spec.ts` failed with it). So it was not done.

Options for the maintainer:
1. Recommended: `test` and `bench` groups of a batch keep the files of the command's cached builds too. After a batched command, the artifact directory then holds what `build` stored, not what `cargo test` wrote. Change `ADR-TEST-AFTER-BUILD`'s accepted consequence, `RISK-ARTIFACT-DIR-WRITERS` ("The files after a run"), `VER-CARGO-UNCHANGED` and the tests that check it. It costs a hard link per file and group. With batching off the case remains (nxr-fpc72j).
2. Keep the files as they are and record the limit in `RISK-ARTIFACT-DIR-WRITERS`. Users then have to make such a task depend on nothing that runs `cargo test`, or not cache it.

- [x] Ask the maintainer which option
- [ ] Implement it, with the check in `VER-BATCHING`

## Decision of the maintainer (20 November 2026)

Asked what should happen for tests, he chose "Put builds' files back (Recommended)". A `test` or `bench` batch keeps the executables of the command's cached builds and puts them back when it ends, so that after a batched command the artifact directory holds what `build` stored, not what `cargo test` wrote; this changes the consequence he accepted with `ADR-TEST-AFTER-BUILD`. A task that reads the file while the tests run can still get `cargo test`'s; that stays a stated limit, as does batching off. Not chosen: failing such test tasks, stating the limit only.

`ADR-TEST-AFTER-BUILD` records the answer (nxr-yfh7zh, phase 1). Still to change with the implementation: `RISK-ARTIFACT-DIR-WRITERS` ("The files after a run"), `VER-CARGO-UNCHANGED` (the artifact directory after `nx run-many -t build test`), `VER-BATCHING` and `DES-BATCH` ("Files that a batch leaves on disk"), and the tests that check the old consequence (`batch-runs.spec.ts`, `test-after-build.spec.ts`). `nx-rust/src/executors/kept-files.ts` and its spec, from commit 41c2299 of nxr-yfh7zh, are the mechanism: change `linkingTargets` to `test` and `bench` and call it from their groups. Its review at d0971e5 found that a glob output is not kept (`keptOutputs` takes the declared output as a literal path), and that a task reading the file while the tests run can still get the test build; the first needs fixing here, and the second is the stated limit.

Note from nxr-yfh7zh (20 November 2026): a `build` whose outputs are explicitly empty declares nothing for a `test` batch to keep. Decide here whether such a build's files are kept too (nxr-j55xdy, closed for builds).
