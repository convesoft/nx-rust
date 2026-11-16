---
title: Run the build input check per task in a batch
status: done
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-agyqmz
  - nxr-s12cpg
related:
  - nxr-s12cpg
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:43Z
closed_at: 2026-11-16T16:19:34Z
---

Goal: when several `build` tasks share one cargo call, the check of `DES-BUILD-INPUT-CHECK` (paragraph "Batches") still runs for each task, and a failure fails only the tasks whose crates read an uncovered file.

Implements the batch part of `REQ-BUILD-INPUT-CHECK` in the batch executor of `DES-BATCH`.

- [x] Run the check per task after the group's cargo call
- [x] Keep the results of the other tasks of the group

Done when: the batch paragraph of `VER-BUILD-INPUT-CHECK` passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

Note from nxr-s12cpg (14 November 2026): `runGroup` (`nx-rust/src/executors/group-run.ts`) runs the check of `DES-BUILD-INPUT-CHECK` for each `build` task whose crate passed, right after its group's command, and fails only that task; the group asks cargo once for the directories. In groups of one crate, all that the batch forms until nxr-8f9dz2, the check therefore runs as for a task on its own. What stays here: the batch paragraph of `VER-BUILD-INPUT-CHECK` with real groups of several crates, which needs nxr-8f9dz2's shared commands, including the case of a feature that another crate of the command turns on.

Note from nxr-8f9dz2 (15 November 2026): nothing of this issue changed. Shared commands are written but switched off (`groupsShareCommands`) until `ADR-TASK-NAME-VARIABLES` and `ADR-WORKSPACE-TEST-EXECUTABLES` are decided, so every batched `build` still runs a command of its own crate and the input check runs as for a task on its own. Still open here: the batch paragraph of `VER-BUILD-INPUT-CHECK` with real groups of several crates, including a binary whose required feature only another member of a whole-workspace build turns on, whose record `nameRecords` leaves out.

Note from nxr-8f9dz2 (16 November 2026): groups now share a cargo command (`groupsShareCommands` and `preferBatch` are on), and `runGroup` (`nx-rust/src/executors/group-run.ts`) runs the check of `DES-BUILD-INPUT-CHECK` for each `build` task of a group whose crate passed, after the group's last step, so that a failure fails that task alone; real batches of several builds now run through it, also in `build-input-check.spec.ts`, whose single-crate cases pass with the whole-workspace command. Not covered yet, and still this issue's: the three cases of the batch paragraph of `VER-BUILD-INPUT-CHECK` (one crate of a group reading an undeclared file beside two that do not; two crates of a group behind a path dependency whose build script reads a file that only one declares; a binary whose required feature only another crate of the group turns on, which under `workspace-build` cargo builds while `nameRecords` leaves its record out).

## Summary of Changes

The code was already in place (nxr-s12cpg); this issue adds the batch paragraph of `VER-BUILD-INPUT-CHECK` as tests in `nx-rust/test/build-input-check.spec.ts`, through real Nx (`nx run-many -t build -p …` without `--batch`) and a real cargo, with groups of several crates that share one `cargo build --workspace`:

- reader (undeclared files), base and plain (declares its file): one cargo call, only `reader:build` fails, base and plain are restored from the cache on the next run while reader runs and fails again;
- left and right depend on the path dependency schema, whose build script reads `shared/proto.txt`; left declares it, right does not: only `right:build` fails, naming that file;
- wants turns on multi's feature `extra`, which multi's binary three requires; three's undeclared file fails nothing (its record names it), while wants' own undeclared file fails `wants:build`.

Mutations, not committed, in `runGroup`: skipping `checksAfterCargo` for groups of more than one member failed all three tests; failing every task of a group when one fails failed all three tests. No product code changed. `VER-BUILD-INPUT-CHECK` now also says that the crate turning the feature on still fails for its own undeclared file, as tested.

Checks on the final head: `pnpm nx run-many -t build lint test --skip-nx-cache` (56 suites, 1769 passed, 1 todo), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete), `zban check`. The end-to-end suite was not run: no product code changed (the brief asks for it only then).
