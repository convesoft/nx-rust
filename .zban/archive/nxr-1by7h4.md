---
title: Find out which fileInputs patterns Nx matches against the files of other projects
status: done
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-agyqmz
created_at: 2026-11-13T22:17:22Z
closed_at: 2026-11-14T08:08:47Z
---

Goal: a `fileInputs` pattern that names files of other Nx projects covers them in the key, or `DES-INPUTS` and the user guide say which patterns do not.

Observed while writing the tests of nxr-agyqmz, with the `nx` 24.0.6 package of this repository and `HashPlanInspector.inspectTaskInputs` on a copy of the `declared-files` fixture (the check of `DES-BUILD-INPUT-CHECK` compares with the same matching). Each pattern was the only `fileInputs` entry of `rust/crates/api/Cargo.toml`:

- `../app/src/main.rs` and `../app/**` matched `rust/crates/app/src/main.rs`, a file of the project `app`.
- `../*/**`, `../*/**/*`, `../*/src/**`, `../*/src/main.rs` and `../a*/src/main.rs` matched no file of `app` or `other`; `rust/crates/api` files and member manifests appeared only through other inputs.
- In `undeclared-files`, `../**` from `rust/crates/reader` (`{workspaceRoot}/rust/crates/**`) matched no source file of the other member crates either.
- `../../../*/banner.txt` matched `docs/banner.txt`, a file of no project.

So a declared fileset whose fixed part does not lie in a project's folder seems to reach only files of no project. A user who declares `../*/**` to cover sibling crates gets a key that misses them, and the build check then fails the build (correctly, since the key misses the files).

- [x] Find in the Nx 24 source how an `includeIgnored` fileset under `{workspaceRoot}` is matched against project files, and confirm with an experiment
- [x] Record what was found as evidence in Mara (`EVD-NX-24-FILE-INPUTS` or a new item) and decide with the user whether `declaredFiles` should rewrite such patterns, warn, or only document the limit
- [x] Update `DES-INPUTS` and the "Files outside the crate" guidance in `caching.mara.md` accordingly

Done when: the decision is in Mara, implemented if it changes behaviour, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

**The rule Nx 24.0.6 follows** (`EVD-NX-24-FILESET-SCOPE`, from the source of tag `24.0.6` and experiments with `HashPlanInspector`). An `includeIgnored` fileset is read from its literal prefix. It belongs to the deepest project whose folder holds that prefix, not counting the project at the repository root, and it takes only that project's own files, never those of a project in a folder below. A fileset whose prefix no project's folder holds takes every file it names. `nx affected` and `HashPlanInspector` apply the same rule. This refines what the issue observed. The patterns that missed `app` and `other` started in `rust/crates`, inside the folder of the workspace project `rust`. Patterns that start where no project's folder holds them, such as `../../../*/crates/*/src/main.rs`, do reach the files of other projects.

**The decision.** It was made by the control plane under `GOAL-TRUSTED-CACHE`; the maintainer was told on 13 November 2026 and did not object. A declared pattern is never silently left unhashed. It is recorded in `ADR-DECLARED-FILE-INPUTS`.

**Implemented** (`DES-INPUTS`, "Patterns over project folders"):
- `declaredFiles` keeps each pattern's own fileset, and adds an `includeIgnored` fileset for each folder of the entry's own projects below the pattern's fixed part, holding the rest of the pattern relative to that folder (`patternsBelow`). For example, `../*/src/**` also gives `rust/crates/<crate>/src/**` for each crate.
- A pattern that starts at the repository root gets none.
- A crate added later gets its fileset at the next graph computation, which `createNodes` runs afresh, also with the daemon.
- In `createDependencies`, `failOnUncoveredProjectFolders` fails graph creation where a pattern names files in the folder of another plugin's or entry's project that no fileset of the crate covers. The message names the manifest, the pattern, the crates and the project, and gives the pattern to add.
- Updated `REQ-BUILD-SCRIPT-INPUTS`, `REQ-FILE-INPUTS-HASHABLE`, `DES-INPUTS`, `DES-BUILD-INPUT-CHECK` (point 6), `DES-DIAGNOSTICS` (a new row), `VER-CACHE-KEYS`, `VER-BUILD-INPUT-CHECK`, and the "Files outside the crate" guidance.

**Tests:**
- `declared-files.spec`: for each pattern of the issue's list, a change to a sibling crate's file and to a file of no crate (or of no project, for `*/banner.txt`) changes the keys of `check`, `lint`, `test`, `build` and `doc`, and `nx affected` selects the tasks. The same holds for `../**` in `undeclared-files`.
- `declared-files.spec` also covers: the named inputs; the error for a `project.json` project, both for a crate's own pattern and a workspace table's; the remedy; a crate and a `project.json` added later with the daemon; and a table of `patternsBelow` cases.
- `build-input-check.spec`: a build that reads a sibling's file through `../*/data.txt` passes, and the folder line shown for `rerun-if-changed=..` makes the build pass.
- With `origin/main`'s sources, 9 of the new declared-files tests and both new build-check tests fail.
- The superset requirement holds: for every pattern of the existing declared-files and build-input-check tests, the inspector listed the same files after the change, and more only for patterns over crate folders. No file went missing.

**Checks run:**
- `pnpm nx run-many -t build lint test`: 975 passed, 1 todo.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 30 passed.
- The two changed specs with `CI=true GITHUB_ACTIONS=true` and the agent variables removed: 89 passed.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` all pass.

**Rejected:**
- Expanding into `{workspaceRoot}` filesets without `includeIgnored`: those are not narrowed, but they leave out files that Git ignores, which `REQ-BUILD-SCRIPT-INPUTS` keys.
- A spelling whose literal prefix is the repository root, such as `[r]ust/...`: it walks the whole repository on disk, including Cargo's build directory.
- A warning instead of the error: the key would still miss the files.

**Follow-ups:** nxr-s0zp3q (Cargo's build directory inside a pattern's folder) and nxr-twpw9k (glob characters in a resolved real path).

## Changes after review

The review of 2a657b5 found three ways in which the rewrite and the guard read glob syntax differently from Nx. All three are fixed:
- A brace alternative that names a folder, such as `../{app,other}/`, left out the members nested below it (a wrong cache hit).
- The guard failed graph creation for `../{app,web}/src/**`, an alternative that starts inside another plugin's project and that Nx hashes correctly.
- The guard failed graph creation for `../@(app|other)/src/**`, which does not reach that project.

What changed, decided by the control plane:
- Braces are replaced by their alternatives first, nested and wildcard ones included, and each alternative counts as a pattern of its own everywhere.
- A pattern that ends in `/`, has no glob, or ends in a name after a glob names folders and covers everything below them. For a glob this adds a `/**` fileset, because Nx drops a trailing `/`.
- Segments are matched with Nx's own engine through its native `matchGlobPaths`, which runs `build_glob_set` with Nx's conversion of extended groups. Where it is unavailable, or a pattern has more than 256 alternatives, a segment counts as a match: generous for added filesets, and the error stays with a remedy that works.
- The harness gained `taskFiles` and `glob`.
- New tests cover the reviewer's three cases, the directory forms, and a table of 24 patterns. For each, the files Nx's glob names must be in `api:check`'s key, and graph creation must fail exactly where the pattern reaches the `project.json` project.

At the maintainer's request, the follow-ups nxr-twpw9k (escaping glob characters in resolved real paths) and nxr-s0zp3q (negating Cargo's build and artifact directories below a pattern's folder) were fixed in the same pull request and closed there.

Checks after merging `origin/main` with #61, #62 and #63: `declared-files.spec` and `build-input-check.spec`, `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check`.
