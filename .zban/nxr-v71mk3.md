---
title: Share one reader of Cargo's configuration chain between dep-info-basedir.ts and build-settings.ts
status: todo
type: task
priority: low
discovered_from: nxr-9f2y12
created_at: 2026-11-14T09:11:43Z
---

Goal: one implementation walks the configuration files that cargo reads for a command started in a folder, with `include` and cargo's precedence, instead of two.

Context: `nx-rust/src/cargo/build-settings.ts` (from nxr-9f2y12) reads `build.<key>` through `configFiles` in `redirections.ts`, for `build.target` (`target-triples.ts`) and `build.rustc` / `build.rustdoc` (`configured-tools.ts`). `nx-rust/src/cargo/dep-info-basedir.ts` has its own copy of `configFiles` and of the include walk for `build.dep-info-basedir`, used by the build input check (`DES-BUILD-INPUT-CHECK`). Its semantics differ on purpose in one point: a file that exists but cannot be read makes the value unknown (`undefined`) instead of being skipped. A shared reader has to keep that difference.

- [ ] Let `dep-info-basedir.ts` read its setting through the shared walk, keeping its handling of unreadable files and of an empty `CARGO_BUILD_DEP_INFO_BASEDIR`
- [ ] Keep the existing tests of both readers passing unchanged

Done when: `configFiles` and the include walk exist once, and `pnpm nx run-many -t build lint test` passes.
