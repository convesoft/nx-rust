---
title: Keep the files of an uncached build that a later cargo command of a batch links again
status: done
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-yfh7zh
created_at: 2026-11-20T16:21:55Z
closed_at: 2026-11-20T20:41:38Z
---

Goal: a cached task that depends on a crate's `build` that Nx does not cache, and reads its executable, never stores a result made from another build's executable (`GOAL-TRUSTED-CACHE`).

Context: since nxr-yfh7zh, each group of a batch keeps the files that the command's other `build` tasks store and puts them back after its commands (`DES-BATCH`, "Files that a batch leaves on disk"). It finds those files through the tasks' declared outputs, and a `build` that Nx does not cache declares none: one with `cache = false` in a `targets.build` table or a `project.json`, and every `build` whose artifact directory lies outside the repository (`ADR-RESULTS-ONLY-CACHE`). A whole-workspace build of another crate, or a `cargo test`, of a later batch still links such a build's executable again with its own environment or features, so that a cached JS target that depends on it and runs the executable stores what it made of the other build (`EVD-BATCH-FILES-ON-DISK`). Not reproduced; it needs a cached task outside the plugin that reads an uncached build's file, which for an artifact directory outside the repository means a task that knows that path. `RISK-ARTIFACT-DIR-WRITERS` ("The files after a run") names the limit.

- [x] Reproduce with `cache = false` on `pa`'s build in the fixture of `batch-deferral.spec.ts`
- [x] If it reproduces, decide in Mara whether to keep the files that the build's metadata records (`artifactFiles`, with the folder of its profile and triple) where Nx declares no outputs, and add the check to `VER-BATCHING`

## Update from nxr-yfh7zh (20 November 2026)

- Correction from the review of nxr-yfh7zh at d0971e5: `cache: false` keeps the inferred outputs, so a `build` with `cache = false` was kept like any other (its run stored `plain`). Only a `build` whose outputs are explicitly empty declares none. An artifact directory outside the repository also gives empty outputs.
- The keeping of files for builds is replaced by staged builds (`ADR-STAGED-BUILDS`, `DES-BATCH` "Staged builds"). They write no other crate's files whatever its outputs declare, so the build part of this issue is settled once nxr-yfh7zh's phase 2 lands; nxr-yfh7zh will say so with a test.
- What remains is a `test` or `bench` batch, which keeps files by their declared outputs (nxr-5hzxra, `ADR-TEST-AFTER-BUILD`). A `build` with empty outputs is not kept there. That belongs to nxr-5hzxra, and this issue can then be closed.

## Summary of Changes

Settled for builds by nxr-yfh7zh. `cache = false` does not reproduce it: the build keeps its inferred outputs (review of nxr-yfh7zh). The case that remained, a `build` whose outputs are explicitly empty, no longer depends on outputs at all. Staged builds (`ADR-STAGED-BUILDS`) write no file of a crate whose `build` is not their own task, whatever that build declares, so there is nothing to keep. The `test` and `bench` side, where a batch keeps the builds' files by their declared outputs, belongs to nxr-5hzxra, whose body names it.

Check: "store pa's own file for a task that depends on a build that declares no outputs (nxr-j55xdy)" in `nx-rust/test/batch-builds.spec.ts`, through the real Nx and cargo; `pack` stores `plain`. `VER-BATCHING` ("Staged builds") names it.
