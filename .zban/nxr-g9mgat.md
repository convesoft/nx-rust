---
title: Decide how fileInputs treats patterns that Nx hashes stale, skips or rejects
status: draft
type: task
parent: nxr-w9qa5f
related:
  - nxr-agyqmz
discovered_from: nxr-d371vy
created_at: 2026-11-13T19:52:45Z
---

Goal: the maintainer decides, for each case below, whether graph creation should reject the `fileInputs` pattern, the plugin should rewrite it, or the documented behaviour stays. Then `DES-INPUTS`, `REQ-BUILD-SCRIPT-INPUTS`, `REQ-FILE-INPUTS-HASHABLE`, `DES-DIAGNOSTICS` and `VER-CACHE-KEYS` are updated, and the code changes in `nx-rust/src/graph/declared-files.ts`.

nxr-d371vy implemented `DES-INPUTS` as written. A pattern whose fixed part resolves outside the repository, also through a symbolic link, already fails graph creation. Nx 24.0.6 behaves as `EVD-NX-24-FILE-INPUTS` records (bullets "Symbolic links" and "Paths in `includeIgnored` filesets"). That leaves these cases inside the repository:

- **A pattern that names a link to a file**, such as `docs/alias.txt -> banner.txt`. Nx keeps the hash of the link's destination until the link changes or `nx reset`. A change to `banner.txt` therefore changes no key of `check`, `lint`, `test` or `doc` and selects no task, a wrong cache hit by design (`REQ-BUILD-SCRIPT-INPUTS`). Only `build` is caught, by the check of nxr-agyqmz. Options: fail graph creation when the fixed part of a pattern is a link (one `lstat`), or put the real path into the fileset.
- **A pattern through a link to a folder inside the repository**, such as `shared/linked/*.sql` with `linked -> real`. Nx hashes the files afresh, so the key changes. `nx affected` matches changed files by their real paths, so it selects no task. Putting the real path into the fileset would fix both.
- **A glob over a folder that holds a link to a folder**, such as `shared/**` with `shared/outlink -> /elsewhere`. Nx's walk does not descend into the linked folder, so its files are not hashed and no error is shown. Detecting this needs a walk at graph time.
- **A `..` segment after a glob character**, such as `../proto/*/../x.proto`. The plugin resolves `..` only before the first glob segment. Nx then fails the hash of every task of the crate, and its message names the fileset, not the manifest. The plugin could report it at graph creation instead.

- [ ] Ask the maintainer for a decision on each case
- [ ] Update the Mara items, then the code and the rows of `nx-rust/test/declared-files.spec.ts`
