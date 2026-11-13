---
title: Judge whether Nx ignores Cargo's directories by the folder that the system reaches
status: todo
type: bug
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-5gzr0n
created_at: 2026-11-13T21:09:09Z
---

Goal: the warning about a build or artifact directory inside the repository that Nx does not ignore (`DES-DIAGNOSTICS`, "Directories that Nx does not ignore") names, and checks against `.gitignore` and `.nxignore`, the folder that cargo actually writes to, as the outputs and the other artifact-directory warnings do since nxr-5gzr0n (`DES-OUTPUTS`).

Context: `unignoredDirectoryWarnings` in `nx-rust/src/graph/unignored-directories.ts` takes `build_directory` and `target_directory` from the report and makes them relative to the repository root with `path.relative`, which resolves `..` as text and follows no symbolic link. nxr-5gzr0n made `locateArtifactDirectories` and `artifactDirectoryWarning` in `caching.ts` use `physicalPath` (`real-path.ts`) relative to the repository's real path, but left this warning alone. Seen on 13 November 2026 with cargo 1.100.0 and Nx 24, in the test "leave build and doc uncached, and say so, when a symbolic link inside the repository leads the artifact directory outside" (`nx-rust/test/caching.spec.ts`): with `tools/.cargo/config.toml` setting `target-dir = "out"` and `tools/out` a link to a folder outside the repository, graph creation warned that `tools/out` lies inside the repository and Nx does not ignore it, and advised adding `/tools/out/` to `.gitignore`, although cargo writes outside the repository. The test adds that line to its `.gitignore` to keep the case apart. By the code, the reverse also holds: a directory spelled outside the repository that a link leads inside gets no warning, and `tools/link/../target` with `tools/link -> ../deep/child` is checked as `tools/target`, not `deep/target`. `buildDirectoryInside` in `nx-rust/src/generators/init/report.ts`, which `init` uses to suggest `build.build-dir`, compares the text path in the same way. Not run: what Nx's file walker does with a link to a folder inside the repository.

- [ ] Decide in Mara (`DES-DIAGNOSTICS`) which path the warning and `init` judge and name where the text path and the physical path differ
- [ ] A test for each of the cases above
