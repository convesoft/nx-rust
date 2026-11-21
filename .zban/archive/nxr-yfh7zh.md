---
title: Build whole-workspace builds and artifact compiles in a stage, so that no build replaces another task's files on disk
status: done
type: bug
priority: high
parent: nxr-e2z8sz
blocked_by:
  - nxr-k63csj
related:
  - nxr-fpc72j
  - nxr-5rrkay
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:58:25Z
closed_at: 2026-11-21T09:46:31Z
---

Goal: a cached task that depends on a crate's `build` and reads its executable never stores a result made from another build's executable (`GOAL-TRUSTED-CACHE`), in a batch and with batching off. No build ever replaces on disk, even for a moment, the final artifacts of a crate whose `build` is not one of its own tasks.

Context: found by the review of nxr-k63csj. A build of the whole workspace links every member's executables again with its own environment or feature set. That happens after a build of an earlier wave, after a build that Nx restored before the batch, and with batching off. A cached task outside the batch that depends on the earlier build then reads the later build's file (`EVD-BATCH-FILES-ON-DISK`). The first remedy (each later group keeps the other builds' files and puts them back afterwards, commit 41c2299) was reviewed at d0971e5 and does not close the defect. While the later group's cargo runs, the files on disk are the other variant: a `pack` that is already running, or a continuous task started between waves, reads and caches `flag`. An output declared as an Nx glob is not kept. Two targets that own one path corrupt each other's entry. The review also confirmed nxr-f04xen with a run: the early hash of a build left for a following batch gives a wrong hit.

## Decisions of the maintainer (20 November 2026)

- Asked "nxr-yfh7zh: two builds of one Cargo workspace whose commands differ (a crate with its own RUSTFLAGS in a dotenv file, or its own feature set) replace each other's executables on disk within one command, so a cached task that runs such an executable (a packaging step) can store a result made from the wrong build. The fix that was built (keep the files, put them back afterwards) leaves a window. How should builds be made safe?", he chose "Stage artifacts (Recommended)". Whole-workspace `build` and `napi-build` run cargo with `--target-dir <stage>` and `build.build-dir` set to the real directory, then move only their own crates' final files into the artifact directory. This leaves no window and also fixes batching off. Leaving a build for a later batch goes away, together with its confirmed wrong cache hit. `REQ-CARGO-UNCHANGED` and `DES-INVOCATION` are amended: two more cargo flags, visible with `--verbose`. `nx build pa` no longer refreshes other crates' executables in `target/`. Two configurations of one crate into one folder fail with guidance instead of sharing a command. It is a new high-risk piece of work that starts with a spike, and the keep-and-put-back remedy for builds is dropped. Not chosen: refusing such commands, keeping and putting back, stating the limit only.
- Asked what should happen for tests (nxr-5hzxra), he chose "Put builds' files back (Recommended)". A `test` or `bench` batch keeps the executables of the command's cached builds and puts them back when it ends, so that after a batched command the artifact directory holds what `build` stored, which changes the consequence accepted with `ADR-TEST-AFTER-BUILD`. A task that reads the file while the tests run can still get `cargo test`'s; that stays a stated limit, as does batching off. Not chosen: failing such test tasks, stating the limit only. nxr-5hzxra implements it after this issue.

## Phase 1: spike and knowledge (no executor code)

- [x] Spike the staged design with real cargo 1.91.0 and 1.100.0 and the real Nx, and record it as evidence (`EVD-STAGED-BUILDS`)
- [x] Write the design into Mara (`ADR-STAGED-BUILDS`, `DES-BATCH`, `DES-INVOCATION`, `DES-BUILD-DIRS`, `DES-OUTPUTS`, `DES-DIAGNOSTICS`, `REQ-CARGO-UNCHANGED`, `REQ-VERBOSE-COMMAND`, `VER-BATCHING`, `RISK-ARTIFACT-DIR-WRITERS`, `ADR-TEST-AFTER-BUILD`), keeping `mara project validate` valid
- [x] Record the maintainer's answer in nxr-5hzxra and drop its `maintainer` tag

## Phase 2: implementation (after nxr-1tmme6 is integrated)

- [x] Stage whole-workspace `build` groups, and every `napi-build` and `wasm-build` compile, in a batch and for a task run on its own; move the own crates' final files and records; clean the stage, also a stale one
- [x] Refuse, before cargo runs, two `build` tasks of one crate in one command whose files lie in one folder
- [x] Remove the leaving of groups for a following batch and the keeping of files for builds, as far as they have no purpose left (keep `kept-files.ts` for nxr-5hzxra)
- [x] Turn the batch tests around and add the reviewer's reproductions as tests: the running `pack`, the continuous task, the glob, the wrong hit of nxr-f04xen, batching off
- [x] Close nxr-f04xen and nxr-fpc72j if a test shows each settled, otherwise update them; say whether nxr-j55xdy is settled

Done when: the reproductions store the right files, plain cargo afterwards compiles nothing more than it would have, Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` (also on Cargo 1.91) and `pnpm nx format:check --all` pass.

## The first remedy (replaced)

Commit 41c2299 made each later `build`, `napi-build` and `wasm-build` group keep the declared outputs of the command's other cached builds under a hard link and put them back after its commands (`nx-rust/src/executors/kept-files.ts`). It fixed the sequential cases, but leaves the window described above. `kept-files.ts` stays for nxr-5hzxra; builds stop calling it in phase 2.

## Summary of Changes

- **Staged builds.** A `build` that selects the whole workspace, and every `napi-build` and `wasm-build` compile, run cargo with `--target-dir <artifact dir>/.nx-rust-stage/<pid>-<n>` and `--config build.build-dir="<build dir>"`, the build directory that cargo reports for its root and environment. This holds in a batch and for a task run on its own: `nx-rust/src/executors/staged-run.ts` (`runTargetGroup`) is called from `runReadyGroup` in `batch.ts` and from `runTask` in `task.ts`. The stage logic is in `nx-rust/src/executors/stage.ts`.
  - A `build` moves its own crates' `bin`, `cdylib` and `staticlib` files, with their `.dwp`, and the records of all its crates' targets into the artifact directory by rename (a copy where file systems differ). It does this right after cargo, inside the step (`runGroup`'s `observe`), before the reset of Nx's workspace context and the build input check.
  - `napi-build` and `wasm-build` post-process from the stage and move nothing. Their build input check reads the records in the stage (`recordsFolder` in `input-check.ts`).
  - The stage is removed when the group ends. A stage of a dead process, or of a reused pid with another start time, is removed by the next staged command.
  - A failure to make the stage or to move a file fails the task.
- **The batch.** No group writes another task's files, so the leaving of groups for a following batch is gone, and `unreportedProblems` only fails a task that the batch did not report. Two `build` tasks of one crate into one folder are refused before cargo (`sharedBuildFolders`), in a batch and on their own, judged by the outputs that Nx resolved for each task in the command's task graph (fix round). Where Nx restores every such task, none runs and none fails. Builds no longer call `kept-files.ts`, which stays for nxr-5hzxra.
- **Tests.**
  - `nx-rust/test/batch-builds.spec.ts` (formerly `batch-deferral.spec.ts`) has the turned-around batch tests and the reviewer's reproductions:
    - the read while `pb`'s build is held after cargo, which stands for an already running `pack` and a continuous task;
    - the glob output;
    - the early hash of nxr-f04xen;
    - batching off at `--parallel=1` and `3`;
    - empty outputs;
    - the refusal.
  - `nx-rust/test/stage.spec.ts` covers the stage itself.
  - The harness's `workspaceArgs("build")` is the staged form, the cargo wrapper normalises the stage's name, and `holdCargo` can hold after cargo.
  - The napi and wasm specs expect staged compiles and check that they leave the artifact directory alone. Their warm-fixture guards run the staged command and still find every third-party crate `Fresh`.
- **Settled issues, each by a test in `nx-rust/test/batch-builds.spec.ts`:**
  - nxr-f04xen by "build pb again where its key reads pa's output and pa changed, instead of restoring it under an early key (nxr-f04xen)".
  - nxr-fpc72j by "leave pa's own file to a task that runs after pb's build, and store each build's own, with batching off and --parallel=1 / --parallel=3 (nxr-fpc72j)".
  - nxr-j55xdy by "store pa's own file for a task that depends on a build that declares no outputs (nxr-j55xdy)". Its test-batch part belongs to nxr-5hzxra.
- **Mara.** New: `ADR-STAGED-BUILDS`, `EVD-STAGED-BUILDS` (spike on cargo 1.91.0 and 1.100.0 and through Nx 24.0.6) and `EVD-BATCH-FILES-ON-DISK`. Changed: `DES-BATCH` ("Files that a batch stores", "Every task in the batch that receives it", "Staged builds"), `DES-INVOCATION`, `DES-BUILD-DIRS`, `DES-OUTPUTS`, `DES-NAPI`, `DES-WASM`, `DES-BUILD-INPUT-CHECK` (point 5), `DES-DIAGNOSTICS`, `REQ-CARGO-UNCHANGED`, `REQ-VERBOSE-COMMAND`, `VER-BATCHING`, `RISK-ARTIFACT-DIR-WRITERS` and `ADR-TEST-AFTER-BUILD`. The last records the maintainer's answer for tests, which nxr-5hzxra implements.

Checks run, after merging `main` at aadd55f:
- `pnpm nx run-many -t build lint test`: 80 suites, 2120 passed, 61 skipped, 6 todo.
- `pnpm nx format:check --all`: passed.
- `mara schema validate`: valid. `mara project validate`: valid, evaluation complete.
- `zban check`: no errors.
- `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0: 27 passed.
- The same suite on Cargo 1.91.0 through a private `RUSTUP_HOME`, with `--skip-nx-cache`: 27 passed.
- `batch-builds`, `caching-runs`, `executors` and `workspace-build` as CI runs them (`CI=true GITHUB_ACTIONS=true`, agent variables removed): 4 suites, 92 passed.
- Before the merge, the napi, wasm and fixture-builds specs with the wasm cases running (a private `RUSTUP_HOME` defaulting to 1.100.0 and `wasm-bindgen` 0.2.130): 31 passed.

## Decisions made

- **Staged builds:** chosen by the maintainer, as were `test` and `bench` batches keeping and putting back the builds' files (nxr-5hzxra). Recorded in `ADR-STAGED-BUILDS` and `ADR-TEST-AFTER-BUILD`.
- **Stage location:** `<artifact dir>/.nx-rust-stage/<pid>-<n>`, decided by the control plane. It is on the file system of the files it replaces, among Cargo's directories, which the input check skips (this covers Cargo 1.91's record paths), and `cargo clean` removes it. A marker with the process start time tells a dead or reused-pid stage from a live one. Nothing that the plugin's own outputs and inputs name reaches it; a Cargo directory in a project's folder that git does not ignore is read by Nx whole, a left stage included, which DES-DIAGNOSTICS already warns of. Recorded in `ADR-STAGED-BUILDS` and `DES-BATCH` ("Staged builds").
- **`--nx-bail`:** Nx 24 does not tell a batch about it, so a later group of the same batch process still runs and is stored after a group failed. This is provisional until the maintainer decides; were Nx to tell the batch publicly, the batch would start no further group. Recorded in `DES-BATCH` ("Every task in the batch that receives it"), `ADR-STAGED-BUILDS` and `EVD-STAGED-BUILDS`.
- **Refusal:** two `build` tasks of one crate whose files lie in one folder (artifact directory, triple and profile folder) fail before cargo runs, with guidance to run them in separate commands, in a batch and on their own. This is the maintainer's answer. Recorded in `DES-BATCH` ("Files that a batch stores") and `DES-DIAGNOSTICS`.
- **Order of moves:** `build` moves its files and records before the workspace-context reset and the input check, so that the listing is no older than the move. Recorded in `DES-BUILD-INPUT-CHECK` (point 5) and `DES-BATCH`.
- **What is staged:** whole-workspace `build`, and every `napi-build` and `wasm-build` compile. `build` groups that select with `-p` write only their own crates' files and are not staged; `test` and `bench` are never staged, because `cargo test` fixes the stage's path into `CARGO_BIN_EXE_<name>`. Recorded in `DES-BATCH` and `EVD-STAGED-BUILDS`.
- **Records:** a `build` moves the records of every target of its crates, an rlib-only library's and a proc macro's included, because the input check reads them; their own files stay in the stage. Recorded in `DES-BATCH` ("Staged builds").


## Fix round after the first review (at 386309f)

Changes:
- **The refusal reads Nx's resolved outputs.** `sharedBuildFolders` (`stage.ts`) now judges a collision by the `outputs` of the tasks in the command's task graph, for the task and its peers alike: an equal entry, or one entry inside the other. It reads no option of a peer, so it no longer re-implements Nx's option resolution.
  - What the task graph carries on Nx 24.0.6, in a batch and for a single task: interpolated outputs relative to the repository. A crate's `build` with `build.target` set to the host triple in Cargo's configuration, and its alias with `targetTriple` set to the host, both resolve to `rust/target/<host>/debug/<bin>`, so the implicit and explicit host triple are caught.
  - The message names the folder as the outputs name it, artifact directory included.
  - Dashed command-line check: `nx run tool:build --target-triple=<host> --batch=false` passes the triple neither to the executor (cargo got no `--target`) nor to the outputs, and Nx stored `rust/target/debug/tool`, which is what cargo built. The stored files are right, so nothing was filed.
- **Warm hits are a stated limit** in `DES-BATCH` and `DES-DIAGNOSTICS`. Where one alias is restored and the other runs, the one that runs is refused; a test covers that.
- **napi type folder:** `napi-build` hashes the compile's arguments without the stage's two flags (`GroupInvocation.unstagedArgs`), and passes those to `cargo tree`, so the type folder stays the same from run to run as `DES-NAPI` requires.
- **Early-hash test:** gained an unchanged third run, in which Nx restores both builds and `pb` holds the bytes that the second run built.
- **Wording** in `DES-BATCH`, `DES-DIAGNOSTICS`, `DES-NAPI` and `ADR-STAGED-BUILDS`: a failed move fails its crate's task; the bounds follow symbolic links below the artifact directory; "nothing that the plugin's own outputs and inputs name reaches the stage", with the unignored Cargo directory; files of one name are the exception; process namespaces; the plugin sets no `CARGO_TARGET_DIR`; napi's compile moves nothing.

Tests added in this round:
- In `batch-builds.spec.ts`: "fail a build that names the host triple beside one that build.target in Cargo's configuration gives it", and "fail a build that runs beside a build of its crate into its folder that Nx restores, and restore that one". The early-hash test, which settles nxr-f04xen, gained its unchanged third run.
- In `napi-build.spec.ts`: "napi-build in a stage › keeps one type folder from run to run, so that a crate outside the forced closure stays fresh". With the staged arguments hashed again, it fails with two type folders.
- In `stage.spec.ts`: rewritten `sharedBuildFolders` cases on outputs.

The tests that settle the closed issues, all in `nx-rust/test/batch-builds.spec.ts`:
- nxr-f04xen: "build pb again where its key reads pa's output and pa changed, instead of restoring it under an early key (nxr-f04xen)".
- nxr-fpc72j: "leave pa's own file to a task that runs after pb's build, and store each build's own, with batching off and --parallel=1 / --parallel=3 (nxr-fpc72j)".
- nxr-j55xdy: "store pa's own file for a task that depends on a build that declares no outputs (nxr-j55xdy)".

Decisions of this round:
- **The refusal judges by the outputs that Nx resolved in the command's task graph**, not by options; decided by the orchestrator. A `build` whose outputs name nothing is not judged, since Nx stores nothing for it. Two aliases whose outputs name one folder are refused also where their own dotenv files give cargo different artifact directories. Recorded in `DES-BATCH` ("Files that a batch stores") and `DES-DIAGNOSTICS`.
- **Warm cache hits:** where Nx restores every such task, no executor runs and none fails; each entry holds its own build's files, and the folder holds those of the task restored last. Recorded in `DES-BATCH` and `DES-DIAGNOSTICS`.
- **A failed move fails the task of its crate**, while a stage that cannot be made, or a failed report of the directories, fails every task of the group. Recorded in `DES-BATCH` ("Staged builds") and `DES-DIAGNOSTICS`.
