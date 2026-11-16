---
title: "0.5: Releasing with Nx release"
status: done
type: epic
tags:
  - milestone
blocked_by:
  - nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T19:39:32Z
---

Version and publish crates through Nx release. Specified in `nx-rust/docs/release.mara.md` (`REQ-RELEASE`, `DES-RELEASE`) with `ADR-BATCHED-PUBLISH` and `ADR-RELEASE-DEPENDENTS`; verification: `VER-RELEASE`. Publishing rests on the batch executor of milestone 0.2 (nxr-s12cpg), and the hack-crate guard on the detection of cargo-hakari configurations that milestone 0.2 brings (nxr-k64tm5).

- [x] All child issues are closed
- [x] The verification written with the release specification passes
- ~~0.5 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [x] The status note of `release.mara.md` is updated

## Summary of Changes

Closed by the control plane on 16 November 2026, on local `main` at ab45ade, after checking the epic's own list.

- All 14 child issues are `done`. Low-priority and exotic findings of the milestone went to the backlog (tag `backlog`, priority deferred) and are not children.
- `VER-RELEASE`: its nine groups are covered by `release-version`, `release-manifests`, `release-lockfile`, `release-publish-dry-run`, `release-publish`, `release-unpublished`, `release-registries`, `publish-output`, `sparse-registry` and the case in `hakari-graph`, all against the harness's local registries; nothing reached a real registry. On the tree of ab45ade, with a real cargo-hakari 0.9.39 on `PATH`: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` gave 61 suites, 1872 tests passed, 1 todo, none skipped, on Cargo 1.100.0. On Cargo 1.91.0 through a private `RUSTUP_HOME`: the publish, dry-run, registries, unpublished, publish-output and hakari-graph files passed 72 of 72, and the version, manifests and lockfile files 207 of 207. The end-to-end suite passed 27 of 27 on both Cargo versions.
- The status note of `release.mara.md` says releasing is implemented as the page describes, with the known gaps in the backlog.
- The decisions taken on the maintainer's behalf in this milestone are listed in nxr-43zkh8.
