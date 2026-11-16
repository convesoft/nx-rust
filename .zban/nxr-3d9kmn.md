---
title: Read lockfile references to same-named packages of different git sources
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-k64tm5
created_at: 2026-11-16T16:34:58Z
---

Goal: the lockfile task writes digests for a workspace whose `Cargo.lock` holds two packages of one name and version from different git repositories.

Found on 16 November 2026 while writing the hakari tests of nxr-k64tm5: with a member depending on `x` from one local git repository and on `g = { package = "x", git = "<another repository>" }`, both `x 0.1.0`, the lockfile task failed with `nx-rust cannot read the digests of the workspace's members from …/Cargo.lock, which cargo update left: the entry a 0.1.0 names "x 0.1.0 (git+file:///…)", which matches no entry.` Cargo writes such a reference with the source URL without the `#<commit>` fragment that the package's own `source` holds, so the walk of `DES-LOCKFILE-HASHING` ("Digest") finds no entry. Exotic: two crates of the same name and version from two git sources in one workspace.

- [ ] Reproduce it in `lockfile-digest.spec.ts` with a real `cargo generate-lockfile`
- [ ] Match a reference with a source to the entry whose source is the same up to the fragment, as cargo does, and update `DES-LOCKFILE-HASHING` ("Digest") where its text says otherwise

Done when: the reproduction passes and `pnpm nx run-many -t build lint test` passes.
