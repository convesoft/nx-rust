---
title: Read Cargo's configuration files once, through one loader
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:19Z
---

Cites: `DES-INPUTS`, `DES-OUTPUTS`, `DES-RELEASE`, `EVD-CARGO-REDIRECTIONS`.

Goal: one walk over Cargo's configuration files, with cargo's precedence written down once, and one read of each file per workspace. No behaviour changes except where two walkers disagree today, each of which is decided and recorded.

Context: finding 3 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). Wave: seam. `cargo/directories.ts` asks `cargo metadata` and is not part of this. `target-triples.ts`, `warnings-setting.ts`, `configured-tools.ts`, `dep-info-basedir.ts` and `graph/clippy-input.ts` already share `cargo/build-settings.ts`. Four walkers share only `configFiles()` of `cargo/redirections.ts` and repeat the `include` traversal, each differently:

- `cargo/redirections.ts` (`readConfig`): asynchronous, `include` in forward order, one set of read files for the walk, `EISDIR`/`ENOTDIR` count as absent;
- `cargo/build-settings.ts` (`collect`): synchronous, `include` in reverse order, a fresh set per walked file, `EISDIR`/`ENOTDIR` count as unreadable, one table and key per walk of the disk;
- `cargo/configured-runner.ts` (`fileRunner`): reads both files of a folder's pair;
- `release/repository.ts` (`cargoConfigFiles`) with `release/places.ts`: `statSync().isFile()`, `process.env` fixed, unreadable included files dropped silently.

`graph/discovery.ts` so walks and parses the whole hierarchy six times per workspace (redirections, `build.target` twice, `build.rustc`, `build.rustdoc`, `env.CLIPPY_CONF_DIR`), and `executors/task-guards.ts` walks `build.target` twice on a mismatch.

- [ ] List where the four walkers differ in result (order of `include`, deduplication, what counts as unreadable) and decide each difference against a run of cargo
- [ ] One loader that reads and parses each file once into an ordered snapshot, with query functions over it for the readers above
- [ ] Load each workspace's configuration once during graph creation

Done when: the four walkers are one, graph creation reads each configuration file once per workspace, the decided differences are recorded in the evidence item, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
