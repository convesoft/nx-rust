---
title: The doc key of a Cargo workspace at the repository root changes with the JS lockfile
status: done
type: bug
parent: nxr-w9qa5f
related:
  - nxr-5afbsq
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:55:50Z
closed_at: 2026-11-14T07:54:02Z
---

Goal: decide whether the cache key of `doc` on a workspace project at the repository root may change after a change to the JS lockfile outside the plugin's package, which `VER-CACHE-KEYS` lists under "Keys must not differ after", and either fix it or record the limit in Mara.

Found while working on nxr-2ermb0. In `two-workspaces` with a root `package.json` and `pnpm-lock.yaml` (`pnpmLockfile(null)`, so the Rust targets declare `externalDependencies: []`), after a commit that changes only the integrity of `left-pad`, `nx affected -t doc --base=HEAD~1 --head=HEAD --explain=stdout` with Nx 24.0.6 gives `cargo-workspace:doc` these reasons:

- `{"kind": "input-file", "file": "pnpm-lock.yaml", "pattern": "**/*"}`: the project lies at root `.`, so its `default` named input (`DES-INPUTS`, "Crate files" and "Named input") covers every file that Nx assigns to that project, the JS lockfile and the root `package.json` included.
- `{"kind": "moved-ecosystem", "ecosystem": "npm", "file": "pnpm-lock.yaml"}`: the plan hashes npm packages, probably through edges that Nx's JS plugin draws from the project at the root, which owns the root `package.json`, to its dependencies, and `^default`. Not checked further.
- `project-configuration`, the accepted limit of nxr-5afbsq, and `dependent-output` from the lockfile task.

The first two change the key, not only the selection, so `doc` runs instead of being restored. The rows of `VER-CACHE-KEYS` about the JS lockfile are checked in `subfolder-workspace` only (`nx-rust/test/cache-keys.spec.ts`), whose workspace project is not at the root. A crate whose package lies at the repository root presumably hashes the JS lockfile in the same way, by the "Crate files" rule. Not checked.

- [x] Check with Nx's hasher which keys of a workspace project at the repository root (and of a root package's crate) change with the JS lockfile and the root `package.json`, and why
- [x] Get the maintainer's decision on a fix or a documented limit, and update `DES-INPUTS` and `VER-CACHE-KEYS`
- [x] A cache-key row for the workspace at the repository root that follows the decision

## Summary of Changes

Decision, taken by the control plane under `GOAL-TRUSTED-CACHE` ("running more than a key promises is fine"): a documented limit with no code change, like nxr-5afbsq. The check had to come first: had a key stayed the same where it must change, that would have been a separate matter to report.

The check, done with Nx 24.0.6's own task hasher in the fixture harness: `two-workspaces` with a root `package.json` and `pnpm-lock.yaml`, once as the fixture is (virtual workspace, project `cargo-workspace` at `.`) and once with a package `rootpkg` added to the root manifest. A change of only `left-pad`'s integrity, with or without the plugin in the lockfile, changed the keys of `cargo-workspace:doc` and of every cached target of `rootpkg` (`test`, `build`, `check`, `lint`, `fmt-check`, `doc`). There were two reasons. The project's `default` fileset `{projectRoot}/**/*` at `.` covers `package.json` and the JS lockfile. Nx's JS plugin draws a static edge from that project to `npm:left-pad`, which `^default` hashes. A change of only the root `package.json`'s `description` changed the same keys, through the fileset alone. The keys of the root lockfile task, of the crates in subfolders and of `tools/` stayed the same. No key stayed the same where it must change.

Recorded:

- a dated bullet "Keys of a project at the repository root" in `EVD-NX-24-PLUGIN-VERSION`;
- the limit in `DES-INPUTS` ("A project at the repository root") and in the caching guide, which also corrects its claim that only the `lockfile` task runs;
- the matching sentence of `DES-LOCKFILE-HASHING` ("nx affected" in `workspaces.mara.md`), which said the same;
- in `VER-CACHE-KEYS`: the "Keys must not differ after" row on the JS lockfile now holds only for projects whose root is not the repository root, and for the lockfile task of one whose root is; a new paragraph describes the root layout; and the end-to-end sentence names the virtual workspace at the root.

Four rows in `nx-rust/test/cache-keys.spec.ts` ("keys of a project at the repository root") pin this behaviour for both layouts, with the JS lockfile and with the root `package.json`.

Checks: `cache-keys.spec.ts` passes (76 tests, the four new rows included), `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete) and `zban check` pass. The end-to-end suite was not run, because no plugin code changed.

## Review corrections

The control plane's review of PR #62 found that the claim "the crates in subfolders keep their keys" was too broad. A crate that depends on the crate at the repository root, directly or through other crates, hashes that crate's folder through `^default`, so its keys follow the JS lockfile and the root `package.json` too. `DES-INPUTS`, the guide, `VER-CACHE-KEYS` and `DES-LOCKFILE-HASHING` now say that the keys that follow these files are those of the project at the repository root and of every crate that depends on it. A fifth row in `nx-rust/test/cache-keys.spec.ts` checks this: `app` depends on `rootpkg`, and after a change of `left-pad`'s integrity `app:test` and `app:build` change while `util`, `tools` and the root lockfile task keep their keys. The same case is a sentence in `EVD-NX-24-PLUGIN-VERSION`.
