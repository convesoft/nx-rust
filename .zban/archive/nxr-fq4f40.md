---
title: Delete the tests that the suite review found to cost more than they are worth
status: done
type: task
tags:
  - tests
created_at: 2026-11-14T11:09:30Z
closed_at: 2026-11-14T11:33:23Z
---

Goal: the unit and end-to-end suites lose the tests that a review of the whole suite found to cost more than they are worth, while every case that a `VER-` item names keeps a test that fails when the behaviour breaks.

Context: on 14 November 2026 the maintainer asked for a review of the test suite for tests that break on refactors, check internal structure in place of results, repeat the implementation, or cover one scenario many times. The review was made at `main` 539363a, and its first list, "Tests to delete", has eleven entries; the maintainer read it and agreed. The second list, "Tests to rewrite", is a separate task. The standard: a good test fails when functionality breaks and still passes when the code is rewritten with the same behaviour; unit tests that only raise coverage go, unit tests that catch real bugs cheaply stay.

For each entry: read the test and the tests said to cover its case, delete it only where a remaining test (file and name) would fail if the behaviour broke, otherwise keep it or move the uncovered assertion into the test that should own it. Check that the case each `VER-` item names still has a test. Then remove helpers, imports, fixtures and harness functions left without a user. This task changes no Mara item.

- [x] 1. `discovery.spec.ts`, `discovery in the plugin`: 21 of its 23 tests (keep "requests the reports afresh…" and "adds no error of its own…")
- [x] 2. `executors.spec.ts`: "fails such a task with NX_RUST_LOCKED=true and leaves Cargo.lock as it is, while update updates it"
- [x] 3. `lockfile-keys.spec.ts`: "the digests of a run follow a stale lockfile…"
- [x] 4. `caching-runs.spec.ts`: "builds with the new compiler under Cargo 1.91 … where a deeper file also includes that file"
- [x] 5. `caching-runs.spec.ts`: the "a list that names it twice" case (deleted after `VER-CARGO-UNCHANGED` was reworded; nxr-w7v76y)
- [x] 6. `fixture-workspace.spec.ts`: "lets a test ask for an agent in GitHub Actions itself"
- [x] 7. `executors.spec.ts`: "is what keeps Nx from restoring it: Nx restores a JS target that its project.json caches"
- [x] 8. `nx-rust-e2e/src/nx-rust.spec.ts`: `when a task runs cargo` (3 tests) and "should be installed"
- [x] 9. Graph-shape checks of the internal hand-off in `graph.spec.ts`, `targets.spec.ts` and `build-input-check.spec.ts` (6 tests)
- [x] 10. In-process tests of internal records in `configuration.spec.ts` (2) and `target-defaults.spec.ts` (3; keep the two "blames no…" tests)
- [x] 11. Copies of the implementation and formatting checks in `lockfile-digest.spec.ts`, `configured-tools.spec.ts`, `dep-info-basedir.spec.ts`, `missing-tools.spec.ts` and `compatibility.spec.ts`
- [x] Remove helpers, imports, fixtures and harness functions left without a user
- [x] Record per group what went, what covers each case now and what stayed and why, with the test count, Nx starts where countable and the time of one full unit run, before and after

Done when: `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `pnpm nx format:check --all` and `zban check` pass, and every case that a `VER-` item names still has a test.

## Summary of Changes

45 unit tests and 4 end-to-end tests deleted, two assertions moved into the Nx-level tests that own their case, and for group 5 one assertion and one graph row added after a rewording of `VER-CARGO-UNCHANGED`, the only Mara change. For each deleted test, the test named after "now" fails if the behaviour breaks.

**1. `discovery.spec.ts`, `discovery in the plugin`: 21 of 23 deleted.**
- "finds the workspaces of %s with their members" (15 fixtures): now `graph.spec.ts` "%s has a project per crate and per workspace…" (each member a project at its folder) and `discovery.spec.ts` "reads each workspace of %s with one cargo call" (the workspace roots in order and the reports of path dependencies).
- "finds a workspace at the root, one in a subfolder and a standalone crate": the through-Nx test "reads a workspace at the root, one in a subfolder and a standalone crate with one call each" checked only the cargo calls; it now also checks that every member of the three gets a project (moved assertion, the case `VER-GRAPH` names).
- "gives no project to a member whose manifest Nx left out, and keeps it in the report": "needs no further report for an ignored member that its workspace report covers" checked only the calls; it now also checks the projects, without `testkit` (moved assertion).
- "runs cargo only in createNodes, once per workspace": now "reads each workspace of %s with one cargo call", which counts every call of a whole graph creation, `createDependencies` included; the `app` → `util` edge is in `graph.spec.ts`'s per-fixture graphs.
- "keeps what two entries discovered apart, and reads a workspace they split once": now "two plugin entries in one process", "gives each entry's createDependencies…" and "reads a workspace whose manifests the entries split once per process".
- The two "refuses createDependencies…" tests: they guard messages for calls Nx never makes; no `VER-` item names them.
- Kept: "requests the reports afresh…" and "adds no error of its own…". Removed what only the deleted tests used: the `discoverWorkspaces` import, `excludedFolders`, `seenBy`, and the unused parameters of `manifestsIn` and `dependenciesContext`.

**2. `executors.spec.ts`, the `NX_RUST_LOCKED=true` row of "fails such a task with %s…": deleted**, the locked-option case stays as a single test. `VER-CARGO-UNCHANGED` names `NX_RUST_LOCKED=true` failing a task after a manifest edit with `Cargo.lock` unchanged: now `lockfile-runs.spec.ts` "fails in locked mode with cargo's message on a stale lockfile, changes nothing and runs no crate task", which runs exactly that with the variable; `update` and `fmt-check` in locked mode stay in the kept test, and "passes --locked as it says with NX_RUST_LOCKED=true" shows that the variable gives the option's commands.

**3. `lockfile-keys.spec.ts`, "the digests of a run follow a stale lockfile…": deleted.** Digests that follow a stale lockfile: now the key row "a requirement that a sibling adds and that moves a shared version, which the lockfile task brings into the stale lockfile" and `lockfile-runs.spec.ts` "updates or creates the lockfile with %s as cargo build would, and runs the crates whose dependencies changed" (with "Cargo.lock missing", the crates whose locked dependencies did not change are restored). A current lockfile left as it is: "runs once per run, … and leaves a current lockfile as it is". Digests that stay across runs: "writes correct digests again after the digest folder is deleted or a digest overwritten, and every crate task is restored".

**4. `caching-runs.spec.ts`, "builds with the new compiler under Cargo 1.91 … where a deeper file also includes that file": deleted.** Now `cache-keys.spec.ts` "differ for Cargo 1.91 after the compiler that build.rustc names in a folder's file is replaced, where a deeper file also includes that file"; once the key differs, Nx cannot restore. `VER-CACHE-KEYS` names runs only for `RUSTC` and for `build.rustc` in the Cargo home, both kept. `includedAncestorFiles` stays in the harness for the key test.

**5. `caching-runs.spec.ts`, the "a list that names it twice" row: deleted after all, with a rewording of `VER-CARGO-UNCHANGED`.** It was first kept because the item named this run, and the question was filed as nxr-w7v76y. The maintainer's "Go ahead" covered the rewordings of verification items that the lists need, so the item now checks the duplicate where it is decided. The run through Nx stays for a string and for a list of the host triple and a second installed triple. The graph names the folder of a triple that a list names twice once, and the triples that the plugin reads hold each triple once, for one file's list and for the lists of several files. Now `target-triples.spec.ts` "joins the lists of several files, each triple once, also where one list names it twice, …" (a new assertion for one file's `["a", "a"]`) and `caching.spec.ts` "name the folder of each triple that a list in Cargo's configuration that names one triple twice picks…" (a new row). With the `new Set` of `pickedTriples` removed for a moment, both fail, the graph row on the declared outputs. nxr-w7v76y is closed.

**6. `fixture-workspace.spec.ts`, "lets a test ask for an agent in GitHub Actions itself": deleted.** It checked Nx's own agent and CI output. "gives Nx the same behaviour whatever the outer environment holds" still guards the drift; no `VER-` item names the harness. `observe` lost its unused `env` parameter.

**7. `executors.spec.ts`, "is what keeps Nx from restoring it: Nx restores a JS target that its project.json caches": deleted.** It tested Nx's caching of a JS target. The plugin's side stays in "fails without running cargo, so that no result is stored, when a project.json caches %s" (two runs, both fail, no cargo call); the cache-hit marker is matched positively in `caching-runs.spec.ts` and others.

**8. `nx-rust-e2e/src/nx-rust.spec.ts`, `when a task runs cargo` (3 tests) and "should be installed": deleted.** Checked in the installed package: the plugin has no batch executor and infers no `nx:run-commands` target, so its targets reach cargo only through an executor, which "runs a target through the installed plugin's executor" asserts call for call through the installed plugin. The three probe tests stay in `cargo-wrapper.spec.ts` ("cargo wrapper in a fixture workspace"). "installs the plugin that the global setup built" compares every file of the installed package with the build, which `pnpm ls` did not. The `installProbeExecutor` call and the unused imports went; `placeIn` stays (harness README). The harness README now says that `cargo-wrapper.spec.ts` checks each way and the end-to-end tests the executor's.

**9. Graph-shape checks: 6 deleted.**
- `graph.spec.ts` "creates its edges as implicit…": now "adds an edge when a crate gets a project and no manifest changes".
- `graph.spec.ts` "gives each project its manifest, workspace, package name and the plugin's name in its metadata": the executor's use is in `executors.spec.ts` (e.g. `rust-engine:build` builds `-p engine`), the plugin's name in the name-collision tests across entries.
- `targets.spec.ts` "carry the locked option … in their metadata": now "passes --locked as it says with the locked option"; why an uncached target is uncached is shown by the executor and target-defaults failures.
- `targets.spec.ts` "declare the inputs of audit, deny and update": now the eight "nx affected selects the workspace targets that read %s" cases; the lockfile task's inputs in `caching.spec.ts` "gives the lockfile task its inputs…", the `default` input of the other targets in `caching.spec.ts`'s `DES-INPUTS` test.
- `targets.spec.ts` "lets two targets swap their names": the review found that the executor test left only a chain of renames (`{ lint: "clippy", build: "lint" }`), and a `nameTargets` that rejects a two-way rename passed every test. Now `executors.spec.ts` "runs the command of the default name under the name that targetNames gives, with %s" runs that chain and the swap `{ lint: "check", check: "lint" }` through Nx and asserts the cargo command of each name; with that mutation, the swap case fails.
- `build-input-check.spec.ts` "gives each crate's build … what names the records": now the run tests "fails for a crate that is only an rlib, and for the one binary of two…", "reads no record of a binary whose required feature is off…", "fails for a proc macro…", "reads no record whose name binaries of two crates share…" and "leaves check, lint and test alone while the files are undeclared".

**10. In-process records: 5 deleted.**
- `configuration.spec.ts` "use the defaults where nothing sets them": every executor and key test runs with the defaults.
- `configuration.spec.ts` "add up the inputs of every level…": the review found that the remaining tests took runtime commands only from a crate's own table, so that replacing the merged `runtimeInputs` of a workspace with `[]` passed `configuration.spec.ts`, `cache-keys.spec.ts` and `caching.spec.ts`. Now `cache-keys.spec.ts` "keys with what the repository adds" also has the rows "a change of the output of a command that runtimeInputs adds in the plugin options of the entry that receives the workspace, …" and "… in the workspace table, …". Each changes the keys of `tools` and `scaffold` in two-workspaces and not those of `app` and `util`. The mutation fails both rows; emptying only the options or only the table level fails the row of that level. `envInputs` at each level and `fileInputs` of the workspace table were already covered: emptying any one of them fails a row of "keys with what the repository adds" or "keys with declared files". `fileInputs` of a crate's own table are covered by the declared-files rows, and the plugin options hold no `fileInputs`.
- `target-defaults.spec.ts` "reports a dependsOn that loses the lockfile task as an error…": now "replaces the dependsOn of the crates' targets with %s, losing the dependency on the lockfile task, and also warns about the added dependency".
- `target-defaults.spec.ts` "keeps the lockfile task with ... and only warns about ^build": now 'an entry that adds ^build and keeps the rest with "...": a warning'.
- `target-defaults.spec.ts` "asks Nx for nothing when no target differs": now "does not stop a graph whose targets no entry changes", with an Nx that lacks the internals.
- Kept: the two "blames no…" tests and "places each warning once on each target it concerns…". `findings` and the `load` parameter of `changes` went with the deleted tests.

**11. Copies of the implementation: 7 deleted.**
- `lockfile-digest.spec.ts` "is the SHA-256 of one tab-joined line…": the six property tests after it stay.
- `configured-tools.spec.ts` and `dep-info-basedir.spec.ts`, "takes the … deepest file…" and "reads .cargo/config where it exists…" in each: the shared walk is `buildSettings` (`build-settings.ts`), checked by `target-triples.spec.ts` "takes the string of the deepest file, over the folders above and the Cargo home" and "reads .cargo/config where it exists beside .cargo/config.toml". How each reader resolves a path stays in "resolves a path against the folder above the file's…" and in dep-info-basedir's environment, non-string and include tests, which use the same one-line rule for every file.
- `missing-tools.spec.ts` "starts the message with the tool's name in a sentence" and `compatibility.spec.ts` "are named in words": wording only; the verdict tests still show "Nx 24 and 25" in the messages.

**Numbers** (this machine, other agents running beside it):

| | Before (b6ba07a) | After |
| --- | --- | --- |
| Unit tests | 1,205 (1,204 passed, 1 todo) | 1,164 (1,163 passed, 1 todo): 45 deleted, 1 graph row added, and after review 2 key rows and 1 rename case added |
| Nx process starts through the harness in one unit run | 1,703 (885 graph/hash, 818 `nx`) | 1,683 (879 graph/hash, 804 `nx`) measured before group 5; 1,682 (880, 802) with it, counted from its 2 `nx` commands fewer and 1 graph creation more |
| Jest time of one full unit run | 249.6 s | 241.2 s, 214.8 s in the clean run, and 222.1 s with group 5 |
| End-to-end tests | 30 | 26, 3 `nx` commands fewer |

The starts were counted with a temporary, uncommitted line in the harness's `run()`. The 20 fewer are exactly what the deleted tests started: 6 graph creations (group 9) and 14 `nx` commands (groups 2, 3, 4, 6 and 7); the other 25 deleted unit tests ran in Jest's process. The difference in time is within what other agents' load on this machine moves it. The gain is mostly fewer tests that break on refactors, as the review expected.

**Checks run:** `pnpm nx run-many -t build lint test` before (with the counter: 36 suites, 1,204 passed, 1 todo) and after, with the counter and once more without it (36 suites, 1,160 passed, 1 todo, each time); the 13 changed spec files on their own (418 passed, 1 todo); `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (26 passed); `pnpm nx format:check --all`; `zban check`; `tsc --noEmit` on both spec projects. No Mara file had changed yet, so this round ran no Mara validation. After the checks, `origin/main` gained #72, which changes docs and issues only.

## Changes after the decision on group 5

Group 5 went after all, with the rewording of `VER-CARGO-UNCHANGED` described above (nxr-w7v76y). Checks after that change: `pnpm nx format:write`; `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete, no diagnostics); `caching-runs.spec`, `caching.spec` and `target-triples.spec` (100 passed); the same two tests with deduplication removed (both fail); `pnpm nx run-many -t build lint test` (36 suites, 1,160 passed, 1 todo); `pnpm nx format:check --all`; `zban check`. The end-to-end suite was not run again, because nothing it uses changed.

## Changes after review

The review of 19af07f broke the plugin's source for 13 of the deleted behaviours. The remaining tests caught 11; the two gaps are closed with tests through the real Nx, as the corrected group 9 and 10 entries above say: `runtimeInputs` from the plugin options and from a workspace's table (two new rows of the cache-key matrix), and two targets that swap names (a new case of the executor's rename test). The member folders in `discovery.spec.ts`'s expected table, which no test read any more, went; the table now holds the workspace roots and the path dependency reports, and the members' projects are checked in `graph.spec.ts`.

Checks after these changes. Each reviewer mutation was applied, the new test failed, and the source was restored: the merged `runtimeInputs` replaced by `[]` (both new rows fail), only the options or only the table level emptied (the row of that level fails), and `nameTargets` rejecting a two-way rename (the swap case fails, and nothing in `targets.spec.ts` does). The new tests passed unmutated (5 passed). `cache-keys.spec`, `executors.spec`, `targets.spec`, `configuration.spec` and `discovery.spec`: 282 passed, 1 todo. `pnpm nx run-many -t build lint test`: 36 suites, 1,163 passed, 1 todo. `pnpm nx format:check --all` passes, `mara schema validate` passes, `mara project validate` gives `valid: true` with complete evaluation and no diagnostics, and `zban check` passes.
