---
title: Simplify dotenv-check.ts without re-implementing dotenv-expand 12.0.3
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
  - nxr-4sr6hd
related:
  - nxr-5rrkay
created_at: 2026-11-20T10:24:42Z
---

Goal: replace the 836-line symbolic `dotenv-expand` 12.0.3 simulator in `nx-rust/src/executors/dotenv-check.ts` with a simpler, version-independent check that preserves `GOAL-TRUSTED-CACHE` and `DES-BATCH`.

Context: `dotenv-check.ts` currently re-implements `dotenv-expand` 12.0.3 step-by-step with a 1,000,000-step state-space search, Brent's cycle detection, region tracking, SHA-1 state digests, and Unicode PUA placeholders, and hard-fails whenever Nx upgrades `dotenv-expand` away from exact version `12.0.3` (`RISK-UPSTREAM-CHANGES`, `DES-BATCH`, `VER-BATCHING`).

- [ ] Evaluate replacing the simulator with either a conservative static `$VAR`/`${VAR...}` dependency-graph check over raw dotenv definitions or a `Proxy`-trapped execution of the installed Nx's own `dotenv-expand`
- [ ] Update `DES-BATCH` ("Dotenv files") and `VER-BATCHING` in Mara if the accepted contract for `.env` expansion checks changes, and confirm with the maintainer if any edge-case acceptance narrows
- [ ] Implement the simplified check and remove the exact `12.0.3` version pin
- [ ] Keep existing dotenv-check and dotenv-equivalence tests passing and add coverage for the simplified behaviour

Done when: `dotenv-check.ts` no longer re-implements `dotenv-expand` or pins `12.0.3`, Mara validation passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
