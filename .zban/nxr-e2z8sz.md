---
title: "0.6: Architecture cleanup and hardening"
status: todo
type: epic
tags:
  - milestone
created_at: 2026-11-20T10:22:55Z
---

Clean up fragile internal workarounds, consolidate private Nx adapter code, and fix concrete resolution and performance papercuts ahead of 1.0.

Findings from an architecture review of `nx-rust/src/` after milestones 0.1–0.5 (`GOAL-TRUSTED-CACHE`, `RISK-UPSTREAM-CHANGES`). Any child issue that changes specified behaviour updates the relevant Mara items (`DES-BATCH`, `DES-TARGET-DEFAULT-GUARD`, `DES-INPUTS`, `DES-TEST-MODE`, `DES-METADATA-REPORT`) before code changes land.

- [ ] All child issues are closed
- [ ] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [ ] `mara schema validate`, `mara project validate` and `zban check` pass
