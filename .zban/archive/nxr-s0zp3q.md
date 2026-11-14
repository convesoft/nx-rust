---
title: Keep Cargo's build directory out of a fileInputs pattern whose folder holds it
status: done
type: bug
discovered_from: nxr-1by7h4
created_at: 2026-11-14T08:02:35Z
closed_at: 2026-11-14T09:16:30Z
---

Goal: a `fileInputs` pattern whose files include Cargo's build or artifact directory does not put Cargo's outputs into the cache key.

Found while working on nxr-1by7h4, not yet run. `declaredFiles` (`nx-rust/src/graph/declared-files.ts`) rejects a pattern whose real path lies *inside* the build or artifact directory of the crate's workspace (`REQ-FILE-INPUTS-HASHABLE`), but not one whose folder *holds* it, such as `"../../.."` (the repository root, which the declared-files test already declares) or `"../../**"` from a member of a workspace whose `target` lies in the workspace folder. Every declared fileset has `includeIgnored`, which Nx 24 expands from the disk, git-ignored folders included (`EVD-NX-24-FILE-INPUTS`, `EVD-NX-24-FILESET-SCOPE`). If the walk enters `target/`, the key would change after every build, so it would never hit, and each hash would walk the whole build directory. The filesets that nxr-1by7h4 adds for project folders can give `<crate folder>/**` for a standalone crate whose `target` lies in its own folder, in the same way.

- [x] Confirm with an experiment whether Nx 24.0.6 walks into a git-ignored `target` folder for such a fileset and hashes its files (`disk_expansion/expansion.rs`, `walker.rs` in the Nx source)
- [x] If it does, decide with the user whether `declaredFiles` adds negated `includeIgnored` filesets for the build and artifact directories of the workspaces it knows, fails graph creation, or documents the limit; record it in `DES-INPUTS`
- [x] Add the case to `VER-CACHE-KEYS` and a test

Done when: the behaviour is decided in Mara, implemented if it changes behaviour, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

Fixed in the pull request of nxr-1by7h4 (#64), at the control plane's request.

**Experiment** (14 November 2026, recorded in `EVD-NX-24-FILESET-SCOPE`): `declared-files` with a file in `rust/target/debug`, which `.gitignore` leaves out of Git. With `../../**` and with `../../..`, `HashPlanInspector` listed that file in the key of `api:check`, and the key changed after only that file changed. The disk walk of an `includeIgnored` fileset skips only Nx's fixed exclusions.

**Decision:** the control plane's, under `ADR-RESULTS-ONLY-CACHE`: keep Cargo's outputs out of the key.

**Implementation:** `declaredFiles` adds a negated `includeIgnored` fileset, `!{workspaceRoot}/<directory>`, for each build and artifact directory inside the repository of a workspace that the plugin knows (`knownCargoDirectories`, crates without a project included), wherever it lies below the folder that one of the crate's patterns is read from. Nx applies the negation to the whole group of the crate's filesets and does not walk into the directory. A directory that a pattern of the crate is read from or points into stays. Only another workspace's directory can be such a directory, since one of the crate's own workspace already fails graph creation. Recorded in `DES-INPUTS` ("Cargo's directories"), `VER-CACHE-KEYS` and the user guide.

**Tests** (`declared-files.spec`): with `../../**` and with `../../..`, the named input holds `!{workspaceRoot}/rust/target`, and a real `cargo build -p other`, which writes `rust/target/debug/libother.rlib`, changes none of the keys of `api`'s `check`, `lint`, `test` and `build`, of `app:test` or of `rust:doc`. With the negation switched off, both tests failed.

The negated filesets were enough; nothing more was needed. Checks as listed in #64.
