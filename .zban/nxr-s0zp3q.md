---
title: Keep Cargo's build directory out of a fileInputs pattern whose folder holds it
status: todo
type: bug
discovered_from: nxr-1by7h4
created_at: 2026-11-14T08:02:35Z
---

Goal: a `fileInputs` pattern whose files include Cargo's build or artifact directory does not put Cargo's outputs into the cache key.

Found while working on nxr-1by7h4, not yet run. `declaredFiles` (`nx-rust/src/graph/declared-files.ts`) rejects a pattern whose real path lies *inside* the build or artifact directory of the crate's workspace (`REQ-FILE-INPUTS-HASHABLE`), but not one whose folder *holds* it, such as `"../../.."` (the repository root, which the declared-files test already declares) or `"../../**"` from a member of a workspace whose `target` lies in the workspace folder. Every declared fileset has `includeIgnored`, which Nx 24 expands from the disk, git-ignored folders included (`EVD-NX-24-FILE-INPUTS`, `EVD-NX-24-FILESET-SCOPE`). If the walk enters `target/`, the key would change after every build, so it would never hit, and each hash would walk the whole build directory. The filesets that nxr-1by7h4 adds for project folders can give `<crate folder>/**` for a standalone crate whose `target` lies in its own folder, in the same way.

- [ ] Confirm with an experiment whether Nx 24.0.6 walks into a git-ignored `target` folder for such a fileset and hashes its files (`disk_expansion/expansion.rs`, `walker.rs` in the Nx source)
- [ ] If it does, decide with the user whether `declaredFiles` adds negated `includeIgnored` filesets for the build and artifact directories of the workspaces it knows, fails graph creation, or documents the limit; record it in `DES-INPUTS`
- [ ] Add the case to `VER-CACHE-KEYS` and a test

Done when: the behaviour is decided in Mara, implemented if it changes behaviour, and `pnpm nx run-many -t build lint test` passes.
