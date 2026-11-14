---
title: Judge whether Nx ignores Cargo's directories by the folder that the system reaches
status: done
type: bug
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-5gzr0n
created_at: 2026-11-13T21:09:09Z
closed_at: 2026-11-14T10:00:59Z
---

Goal: the warning about a build or artifact directory inside the repository that Nx does not ignore (`DES-DIAGNOSTICS`, "Directories that Nx does not ignore") names, and checks against `.gitignore` and `.nxignore`, the folder that cargo actually writes to, as the outputs and the other artifact-directory warnings do since nxr-5gzr0n (`DES-OUTPUTS`).

Context: `unignoredDirectoryWarnings` in `nx-rust/src/graph/unignored-directories.ts` takes `build_directory` and `target_directory` from the report and makes them relative to the repository root with `path.relative`, which resolves `..` as text and follows no symbolic link. nxr-5gzr0n made `locateArtifactDirectories` and `artifactDirectoryWarning` in `caching.ts` use `physicalPath` (`real-path.ts`) relative to the repository's real path, but left this warning alone. Seen on 13 November 2026 with cargo 1.100.0 and Nx 24, in the test "leave build and doc uncached, and say so, when a symbolic link inside the repository leads the artifact directory outside" (`nx-rust/test/caching.spec.ts`): with `tools/.cargo/config.toml` setting `target-dir = "out"` and `tools/out` a link to a folder outside the repository, graph creation warned that `tools/out` lies inside the repository and Nx does not ignore it, and advised adding `/tools/out/` to `.gitignore`, although cargo writes outside the repository. The test adds that line to its `.gitignore` to keep the case apart. By the code, the reverse also holds: a directory spelled outside the repository that a link leads inside gets no warning, and `tools/link/../target` with `tools/link -> ../deep/child` is checked as `tools/target`, not `deep/target`. `buildDirectoryInside` in `nx-rust/src/generators/init/report.ts`, which `init` uses to suggest `build.build-dir`, compares the text path in the same way. Not run: what Nx's file walker does with a link to a folder inside the repository.

- [x] Decide in Mara (`DES-DIAGNOSTICS`) which path the warning and `init` judge and name where the text path and the physical path differ
- [x] A test for each of the cases above

## Summary of Changes

- Decision (the control plane's, 14 November 2026): the warning about a Cargo directory inside the repository that Nx does not ignore, and `init`'s list of build directories inside the repository, judge and name the folder that cargo writes to, the physical path relative to the repository's real path, as the outputs and the other artifact-directory warnings do since #54. Written into `DES-DIAGNOSTICS` (paragraph "Directories that Nx does not ignore") and checked by `VER-SETUP`.
- `folderInside` in `nx-rust/src/graph/real-path.ts` gives that folder, `.` for the root, and, where symbolic links make it differ from the reported path as text, the reported path: relative and as cargo wrote it while it stays inside the repository as text, otherwise absolute. `unignoredDirectoryWarnings` (`unignored-directories.ts`) and `buildDirectoryInside` (`generators/init/report.ts`) use it; the message and the list add "(reached through <path>)" in that case, and the `.gitignore` line names the folder reached.
- Tests: `cargo-directories.spec.ts` checks that a link inside the repository that leads the directory outside draws no warning, that a path outside that a link leads to `rust/out` draws the warning for `rust/out`, and that `rust/link/../target` with `rust/link -> ../deep/child` is judged and named as `deep/target`: warned without ignore files and with only `/rust/target/` ignored, silent with `/deep/target/` ignored. `init.spec.ts` checks `init`'s list for the same three cases and a plain one. The test in `caching.spec.ts` no longer needs its `.gitignore` line for `tools/out`.
- Not run, as before: what Nx's file walker does with a link to a folder inside the repository; the decision does not depend on it.
- Checks run: `pnpm nx run-many -t build lint test` (1121 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate`, `mara project validate` (valid, complete evaluation), `zban check`.
