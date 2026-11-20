---
title: Improve runtime-input scripts (overhead, silent /dev/urandom fallbacks, multiline env, hashing side effects)
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
related:
  - nxr-4byqv8
created_at: 2026-11-20T10:24:49Z
---

Goal: make runtime-input commands faster, easier to diagnose on failure, safe with multiline environment variables, and free of avoidable hashing side effects (`DES-INPUTS`, `DES-OUTPUTS`, `DES-TEST-MODE`, `GOAL-TRUSTED-CACHE`, `VER-CACHE-KEYS`).

Context: `nx-rust/src/graph/inputs.ts` generates shell runtime-input commands that invoke Node scripts (`print-artifact-folders.ts`, `print-test-mode.ts`, `print-napi-cli.ts`) with several rough edges:
- `print-artifact-folders.ts` spawns `sh` -> `node` -> `cargo metadata --no-deps` on every hash evaluation of `build` and `doc`.
- Any script failure discards stderr (`2>/dev/null`) and falls back to `od -An -N16 -tx1 /dev/urandom`, making accidental cache misses silent and hard to diagnose.
- `print-test-mode.ts` writes command record files under `.nx/workspace-data` during Nx hashing, introducing cross-task races (`nxr-4byqv8`) and requiring 24-hour stale-folder sweeps in `nx-command.ts`.
- `inputs.ts` filters `env | grep -E ... | LC_ALL=C sort` line-by-line, which mishandles environment variable values containing newlines.

- [ ] Evaluate computing target/artifact directories in Node (or avoiding `cargo metadata` where `.cargo/config.toml` and env vars suffice) while keeping `DES-INPUTS` and `DES-OUTPUTS` exact
- [ ] Surface diagnostics or a structured error/warning mechanism when a runtime-input script fails instead of silently hiding stderr behind `/dev/urandom`
- [ ] Handle multiline environment variables cleanly in the toolchain/env runtime input
- [ ] Revisit whether `DES-TEST-MODE` can avoid mutating `.nx/workspace-data` during hashing (coordinating with `nxr-4byqv8`)
- [ ] Update affected Mara items (`DES-INPUTS`, `DES-TEST-MODE`, `VER-CACHE-KEYS`) if behaviour changes

Done when: agreed improvements are implemented and tested, Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.
