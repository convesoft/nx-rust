---
title: Share one reader of Cargo's configuration chain between dep-info-basedir.ts and build-settings.ts
status: done
type: task
priority: low
discovered_from: nxr-9f2y12
created_at: 2026-11-14T09:11:43Z
closed_at: 2026-11-14T09:20:30Z
---

Goal: one implementation walks the configuration files that cargo reads for a command started in a folder, with `include` and cargo's precedence, instead of two.

Context: `nx-rust/src/cargo/build-settings.ts` (from nxr-9f2y12) reads `build.<key>` through `configFiles` in `redirections.ts`, for `build.target` (`target-triples.ts`) and `build.rustc` / `build.rustdoc` (`configured-tools.ts`). `nx-rust/src/cargo/dep-info-basedir.ts` has its own copy of `configFiles` and of the include walk for `build.dep-info-basedir`, used by the build input check (`DES-BUILD-INPUT-CHECK`). Its semantics differ on purpose in one point: a file that exists but cannot be read makes the value unknown (`undefined`) instead of being skipped. A shared reader has to keep that difference.

- [x] Let `dep-info-basedir.ts` read its setting through the shared walk, keeping its handling of unreadable files and of an empty `CARGO_BUILD_DEP_INFO_BASEDIR`
- [x] Keep the existing tests of both readers passing unchanged

Done when: `configFiles` and the include walk exist once, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

Settled in the pull request of nxr-9f2y12, where the duplication arose, as the maintainer asked. `build-settings.ts` gained `buildSettingsAndUnreadable`, which names each configuration file that exists but cannot be read or parsed in its place in the order (only a missing file counts as absent); `buildSettings`, used for `build.target`, `build.rustc` and `build.rustdoc`, still skips such files. `configuredDepInfoBasedir` now reads `build.dep-info-basedir` through it and stops at an unreadable file as before; its own copy of `configFiles` and of the include walk is gone. `configFiles` in `redirections.ts` takes any read-only environment record.

Checks: a new `nx-rust/test/dep-info-basedir.spec.ts` (the variable and its empty value, deepest file first, the Cargo home, `.cargo/config` beside `.cargo/config.toml`, a non-string value, unreadable files before and after the deciding one, a `.cargo` that is a file, include order and paths) passed against the old reader before the change and against the shared one after it; `build-input-check.spec.ts`, `target-triples.spec.ts` and `configured-tools.spec.ts` pass unchanged; `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
