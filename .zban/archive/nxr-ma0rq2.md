---
title: Rewrite the tests that the suite review found to lock in the implementation
status: done
type: task
tags:
  - tests
created_at: 2026-11-14T11:09:41Z
closed_at: 2026-11-14T12:05:56Z
---

Goal: the twelve tests that the review of the test suite on 2026-11-14 listed under "Tests to rewrite" check behaviour, the way the maintainer put it: "A good test fails when functionality breaks. It shouldn't lock in the current implementation. If the code is rewritten and the behavior stays the same, the test should still pass." A specific expected result is fine; constants that are only implementation details are not.

Context: the review (made at `main` 539363a) found tests that loop over the implementation's own lists, pin internal records, metadata and long command strings, or repeat one scenario across modes, spellings and fixtures. The maintainer read both of its lists and answered "Go ahead", including the changes to verification items that the rewrites need: `VER-SETUP` (init fails for each way graph creation can fail, not for each problem) and `VER-TARGETS` (the splitting rules of `args` are checked on the function, and two cases through Nx). The first list, "Tests to delete", is a separate task. The diagnostics stay an exception to "don't test exact copy": a message test keeps the fact and the remedy sentence (#61), and drops only layout and explanation beyond them.

For each rewrite: read the test, the code and the `VER-` item that names its case; show that the rewritten test fails when the behaviour breaks; where runs are dropped, name what each checked and which remaining assertion checks it now.

- [x] `cache-keys.spec.ts`, "differ after a change of each variable in the list…": type the variables of `DES-INPUTS` into the test and hash once with all of them changed; keep separate runs only for the `CARGO_PROFILE_*` and `CARGO_TARGET_*` families and the target scoping of `CARGO_BUILD_WARNINGS` and `CLIPPY_CONF_DIR`
- [x] `unknown-options.spec.ts`, "is said to be, also after -- and as positional words, %s": all four argument shapes in one mode, `--coverage` alone in the other three
- [x] `executors.spec.ts`, "passes --locked as it says %s": one full run with the locked option, the variable cases on one task each
- [x] `graph.spec.ts` "%s has a project per crate…" and two more pairs with `discovery.spec.ts`: assert `cargoCalls` in the graph tests and drop the discovery copies
- [x] `init.spec.ts`, "stops with graph creation's message for %s" and "stops a run on an nx.json that registers the plugin with %s": one row per way graph creation fails, compared with what graph creation prints; reword `VER-SETUP`
- [x] `graph.spec.ts`, "name collisions after renames and with other projects, %s": assert Nx's error and the folders only, and run the one-entry cases in one isolation mode
- [x] `run-arguments.spec.ts`, "gets the words of args split as a shell splits them…": keep the shell metacharacter and `--args= 3000` through Nx; reword `VER-TARGETS`
- [x] `caching.spec.ts`, "declares the inputs of DES-INPUTS on a member crate": assert sets of files, named inputs and the digest input, not the toolchain command or the code's own lists
- [x] `caching.spec.ts`, "name the folder of each triple that %s picks…" and "leave build and doc uncached … cannot name": keep the outputs and cache flags, drop the metadata and the command regex
- [x] `targets.spec.ts`, "fails graph creation for a key that names no inferred target…": check that it names the key and lists a renamable target, not the whole ordered list
- [x] `configuration.spec.ts`, "take a workspace's per-workspace settings from its table…": observe the effect of `testRunner`, `affectedTests` and `featureUnification`
- [x] The target-defaults messages (`target-defaults.spec.ts`, `caching-runs.spec.ts`): assert the entry, the target, the projects and the remedy, not the explanation and the layout
- [x] For every other entry, read its `VER-` item and reword it only where it names what the rewrite no longer does
- [x] Record the number of unit tests and the time of the changed spec files before and after

Done when: each rewrite has been seen to fail with the behaviour broken (one line per rewrite below), `mara schema validate` and `mara project validate` give `valid: true` with complete evaluation, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `zban check` pass.

## Notes

### Each rewrite fails with the behaviour broken

Each line names the change made to the source for a moment (restored afterwards) and what failed.

- cache-keys "differ after a change of each variable in the list…": removed "RUSTC" and "OPENSSL_NO_VENDOR" from `environmentVariables` in `inputs.ts`; the test failed with "RUSTC: no input of api:build changed with it" (and the same for each task and OPENSSL_NO_VENDOR). The old test, which looped over that list, passes with this change.
- unknown-options "is said to be %s, also after -- and as positional words": made `passedOnCommandLine` in `task-options.ts` never count positional words as typed; the case "with the daemon", which now runs every shape, failed (the line for `-- 3000 serve` named the workspace's configuration), the three `--coverage`-only cases passed.
- executors "passes --locked as it says %s": made `lockedMode` in `task.ts` return the option for `NX_RUST_LOCKED=false`; the case "with NX_RUST_LOCKED=false over the option" failed (`perf:build` and the lockfile task got `--locked`).
- graph "%s has a project per crate … and reads each workspace with one cargo call", "gives edges to the vendored crates, read as standalone crates…", "gives no workspace project … and reads it once more in its root folder" and "fail graph creation for two crates with one name…": made `requestMetadata` in `metadata.ts` run `cargo metadata` twice; all 17 of these tests failed (14 fixtures, the vendored crates, the excluded root manifest, name-collision).
- init "stops where graph creation fails on %s, prints what graph creation prints, and writes nothing": made `initGenerator` in `init.ts` print only the last of graph creation's errors; the case of a problem between projects failed (Nx's own error was missing). With none of the errors printed, all four cases failed.
- graph "name collisions after renames and with other projects, %s": made `failOnNameCollisions` in `collisions.ts` judge each crate by the name the plugin gave it, ignoring a `project.json` that renames it; 5 tests failed, among them "follow a name that a project.json gives, in one entry", which now runs in one mode only.
- graph "fail graph creation with Nx's error for a workspace at the root and one in cargo-workspace/" (split from the table of two workspace projects with one name, whose root row pinned the plugin's best-effort message): renamed the root workspace project in `names.ts`; the test failed (no collision).
- run-arguments "gets the words of args split as a shell splits them, with nothing expanded": made `argsWords` in `task-options.ts` expand `$HOME` as a shell would; the test failed (the binary got the home folder instead of `$HOME`).
- caching "declares the inputs of DES-INPUTS on a member crate": removed `.cargo/config` from the toolchain files in `inputs.ts`; the test failed (the three `.cargo/config` inputs were missing from build's files).
- caching "asks the compiler that Cargo's configuration names by a path with a space and a quote, in the toolchain input" (replaces the two pinned `toolchainCommand` strings): wrapped a named compiler in single quotes without escaping in `inputs.ts`; the test failed (the input never printed the named compiler's line).
- caching "name the folder of each triple that %s picks…": made `outputs.ts` name only the first triple of a list; the two rows with a list failed, the two with one triple passed.
- caching-runs "runs build every time where Cargo's configuration picks a triple whose folder the plugin cannot name, and fails a task that a project.json caches" (now holds the check of the uncached reason that caching.spec read from `metadata.cargo.uncached`): dropped "; give the triple as the targetTriple option instead" from that reason in `outputs.ts`; the test failed.
- targets "fails graph creation for a key that names no inferred target, listing those that can be renamed": made `options.ts` list only the first eight inferred targets; the test failed ("update" missing from the list).
- configuration "take a workspace's per-workspace settings from its table, and elsewhere from the plugin options": put the plugin options before the workspace table in `settings.ts`, first for `testRunner` (the test failed: scaffold's test hashed `tools/.config/nextest.toml`), then for `affectedTests` (the test failed: graph creation accepted `affectedTests = true` in scaffold).
- target-defaults message assertions (target-defaults.spec, caching-runs.spec): made `paragraph` in `target-defaults.ts` leave the last project out of each line and drop the remedy "Add an empty entry keyed by the executor of these targets"; 24 tests failed. As a control, rewording the explanations of "turns on caching" and "adds dependencies" left all 85 tests of both files passing, where the old assertions typed those explanations.

### Dropped runs and where their checks went

- cache-keys, variables: the 28 runs with one listed variable changed each became one run with all of them changed, in which each variable's own entry in Nx's hash details has to change in every task's key (and each key changes). The five runs of the `CARGO_PROFILE_*`/`CARGO_TARGET_*` families and the runs that scope `CARGO_BUILD_WARNINGS` and `CLIPPY_CONF_DIR` stay. 37 hash runs → 9.
- unknown-options: `-- --coverage`, `run-many … --ci` and `-- 3000 serve` without the daemon, without plugin isolation, and with the daemon without isolation (9 Nx runs with cargo) → the same shapes in the case "with the daemon"; every mode still runs `--coverage`, which shows that the hook's record reaches the executor there, and the executor reads every shape from that record in the same way. That `--` survives in the record in both daemon modes is also shown by run-arguments "gets the arguments after -- and the words of args, and no option, %s" (`-- --port 3000`).
- executors, locked mode: the full run "by default" (19 cargo calls without `--locked`) → executors "runs each crate target's command in the workspace root, with the crate's package name", "runs the workspace project's targets in the workspace root" and "runs a binary of each crate in a cargo call of its own", and lockfile-runs "runs once per run, in the workspace root, before any other cargo call…" (`update --workspace`), which all assert unlocked commands. The full runs for `NX_RUST_LOCKED=true`, `=false` over the option and empty → one task each, `perf:build` and the lockfile task it depends on; which commands take `--locked` is shown by the full run with the option, and every executor reads the variable through the same `lockedMode`.
- discovery → graph: discovery "reads each workspace of %s with one cargo call" (15 fixtures) → graph "%s has a project per crate and per workspace, with an edge per path dependency, and reads each workspace with one cargo call" (the 14 fixtures with a graph) and, for name-collision, graph "fail graph creation for two crates with one name, naming both manifests and the remedies", which now asserts the error's `cargoCalls`. Discovery "reads the vendored crates as standalone crates once they are no longer excluded" → graph "gives edges to the vendored crates, read as standalone crates, once they are no longer excluded". Discovery "reads a workspace whose root manifest Nx does not hand to the plugin once more in its root folder" → graph "gives no workspace project to a workspace whose root manifest is excluded, and reads it once more in its root folder" (its project list was asserted there already). 17 graph creations fewer.
- graph, names after renames: "follow a name that a project.json gives, in one entry…" and "leave a name that a project which is not the plugin's holds too to Nx's error, in one entry" no longer run in plugin workers (7 graph creations): with one entry, all of the plugin's work happens in one process in either mode, and both cases still run in one process. Two entries still run in both modes.
- run-arguments: `server:run --bin server --args=--port 3000 --log a,b` → split-words row `--port 3000 --log a,b` and run-arguments "gets the arguments after -- and the words of args, and no option, %s" (`--bin migrate --args=--port 3000`, daemon on and off); `--args=a '' b` and `--args=a\ b "c d" e` → the split-words rows of the same inputs; `--args=$HOME "$PATH" *.rs #x '\n'` → a new split-words row of that input, and `$HOME *.rs` added to the kept metacharacter run. `-- 3000` stays through Nx: it is the only run of a lone positional word after `--`, which `forwardedArguments` handles through `_`, not through splitting.
- caching, inputs: the `env` inputs → cache-keys "differ after a change of each variable in the list…"; the two pinned `toolchainCommand` strings → the new caching test "asks the compiler that Cargo's configuration names by a path with a space and a quote…" and the cache-keys rows "where a setting names the compiler"; `externalDependencies: []` → the cache-keys rows on the JS lockfile; `metadata.cargo.digests` → lockfile-keys and lockfile-runs.
- caching, triples: `metadata.cargo.triples`, `configuredPick`, `tripleProblem`, the artifact input's command and its absence on the other targets → artifact-folders.spec and caching-runs.spec, whose real runs use them; `metadata.cargo.uncached` (with its remedy) → caching-runs "runs build every time where Cargo's configuration picks a triple whose folder the plugin cannot name, and fails a task that a project.json caches"; the warning is still asserted, fact and remedy, from the graph.
- configuration, per-workspace settings: `setInTable` → "several entries of the plugin" "accept different values where the workspace table sets the setting"; `locked` → executors' locked mode; `featureUnification` has no effect yet (`inputSettings` fixes `workspace-build` until nxr-k64tm5), so nothing can observe its precedence; nxr-k64tm5 now says to check it by the effect it adds.
- init, rows dropped from the two failure tables, each with the test that checks its message and remedy:
  - a project table in a root manifest that defines a crate → configuration "graph-creation errors" "a project table in a root manifest that defines a crate";
  - an unknown key in the project table of a workspace table → configuration "an unknown key in the project table";
  - a different executor, a command on an inferred target → configuration "a different executor on an inferred target", "a command on an inferred target";
  - affectedTests = true without the setting → configuration "affectedTests = true among the options of test, without the setting";
  - an implicitDependencies entry starting with ! → configuration "implicitDependencies entries starting with !, naming a Cargo dependency and naming none";
  - inputs without "..." → configuration 'inputs without "..." on an inferred target', which now asserts the remedy that only init's row asserted;
  - a key the executor does not know, an option the target does not take → configuration "a key that the executor does not know in a package table's options", "options that the executor knows and the target does not take";
  - pluginVersion in a target table → configuration "pluginVersion, which only the plugin sets, in options and in a configuration";
  - pluginVersion in a project.json, in a targetDefaults entry keyed by the executor → plugin-version "from a project.json, naming the file, and from a targetDefaults entry beside it", "from a targetDefaults entry keyed by the executors, naming the entry and every target it reaches";
  - a targetDefaults entry keyed by the executor that replaces inputs → target-defaults "replaces inputs through an entry keyed by the executor, naming its element that applies", which now asserts both remedies;
  - the four fileInputs rows → declared-files "fail graph creation for patterns that resolve into the workspace's build or artifact directory", "…that resolve outside the repository…", "…for a pattern that names files of another plugin's project in a folder below where it starts…", "…for patterns with a .. segment after a glob character";
  - the three target field types → configuration "a target field of another type than Nx gives it: …";
  - targetNames giving two targets one name, a key that names no inferred target, an empty name → targets "fails graph creation when two targets of a project get one name…", "fails graph creation for a key that names no inferred target, listing those that can be renamed", "fails graph creation, saying what it has to be, when it is an empty name";
  - locked that is neither true nor false → executors "fails graph creation when the locked option is neither true nor false";
  - two entries with different values of a per-workspace setting → configuration "fail for different values of each per-workspace setting, naming the workspace, the setting and both entries" (three modes).
  The kept rows: an unknown key in a metadata table (a manifest), a crate named like its workspace project (between projects), an unknown option of the plugin's entry (the options, on a registered nx.json), a Cargo configuration file that is no valid TOML (cargo itself).

### Numbers

Measured on this machine, the 13 changed spec files run together in one Jest run with 3 workers, before (at b6ba07a) and after:

| File | Tests | Time |
| --- | --- | --- |
| cache-keys.spec.ts | 96 → 96 | 89.8 s → 75.3 s |
| caching-runs.spec.ts | 27 → 27 | 58.7 s → 57.3 s |
| caching.spec.ts | 47 → 48 | 14.2 s → 12.9 s |
| configuration.spec.ts | 83 → 83 | 19.0 s → 18.0 s |
| discovery.spec.ts | 58 → 41 | 11.6 s → 6.2 s |
| executors.spec.ts | 31 → 30 | 43.0 s → 37.9 s |
| graph.spec.ts | 58 → 56 | 25.2 s → 19.7 s |
| init.spec.ts | 78 → 53 | 13.8 s → 8.1 s |
| run-arguments.spec.ts | 13 → 13 | 24.8 s → 20.6 s |
| split-words.spec.ts | 19 → 21 | 0.1 s → 0.0 s |
| target-defaults.spec.ts | 58 → 58 | 17.8 s → 16.2 s |
| targets.spec.ts | 40 → 40 | 10.4 s → 9.1 s |
| unknown-options.spec.ts | 19 → 19 | 36.6 s → 26.4 s |
| all 13 | 627 → 585 | 364.9 s → 307.7 s (wall 127 s → 104 s) |

The unit suite has 1163 tests after (1162 passed, 1 todo), 1205 before (the other files are unchanged). The single slowest test, cache-keys "differ after a change of each variable in the list…", went from 14.5 s to 3.6 s in these runs.

## Summary of Changes

- Twelve entries of "Tests to rewrite" in the review of 2026-11-14, as listed above. The test files changed are `cache-keys`, `unknown-options`, `executors`, `graph`, `discovery`, `init`, `run-arguments`, `split-words`, `caching`, `caching-runs`, `targets`, `configuration` and `target-defaults` (`.spec.ts`), and the harness gains `metadataCall` and `workspaceCall` in `harness/cargo-wrapper.ts`, shared by discovery, graph and init.
- Where I did otherwise than the review said: `featureUnification` has no effect yet (`inputSettings` fixes `workspace-build` until nxr-k64tm5), so the per-workspace settings test observes `testRunner` (the `.config/nextest.toml` input) and `affectedTests` (the option check) only; nxr-k64tm5's task item now says to check the precedence by the effect it adds. In run-arguments, `-- 3000` stays through Nx beside the two cases the review kept: it is the only run of a lone positional word after `--`, which goes through `forwardedArguments`, not through splitting; `$HOME *.rs` joined the kept metacharacter run so that a shell on the way would show. In caching, the two pinned `toolchainCommand` strings also checked the quoting of a compiler path with a space and a quote; a new test runs the toolchain input with such a compiler named in `build.rustc`. The `metadata.cargo.uncached` reason, the only check of its remedy, moved into the caching-runs run of a `project.json` that caches `build`.
- Same matter, fixed here: in graph, the root row of "two workspace projects with one name" pinned the plugin's best-effort message (`DES-PROJECT-GRAPH`); it is now a test of Nx's error. In target-defaults, every message assertion now checks the entry, the change and its targets, the projects and the remedy, not only those with the "Nx could restore…" explanation, since the other change kinds pinned layout and explanation the same way; "replaces inputs through an entry keyed by the executor…" and configuration 'inputs without "..." on an inferred target' gained the remedy assertions that only init's dropped rows had made.
- Mara: `VER-SETUP` says that `init` fails, says it did not add the plugin, prints what graph creation prints and writes nothing for each way graph creation can fail, with the messages checked where each error's own case is. `VER-TARGETS` checks the splitting rules of `args` on the function and three cases through Nx. `VER-GRAPH` says that a collision in one entry is checked in one isolation mode. The other entries' items still describe what the tests do.
- Checks run: `pnpm nx run-many -t build lint test` (36 suites, 1162 passed, 1 todo); `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, evaluation complete, no diagnostics); `zban check`. The end-to-end suite was not run: nothing it uses changed. The deletion task (another pull request) touches the same spec files in other places.
