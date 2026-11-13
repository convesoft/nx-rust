---
title: Report target defaults that change Rust targets
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-pana9e
created_at: 2026-11-12T18:20:01Z
---

Goal: a repository learns when one of its `targetDefaults` entries adds `^build` to Rust targets or replaces their inferred inputs.

Implements the draft `REQ-TARGET-DEFAULT-GUARD` (`nx-rust/docs/targets.mara.md`), which mitigates `RISK-TARGET-DEFAULTS`. The requirement has to be accepted first, using the result of the spike that blocks this issue.

- [ ] Accept `REQ-TARGET-DEFAULT-GUARD` with a design and verification, after the user agrees
- [ ] Implement the report and name the entry, the target and the fix
- [ ] Document narrowing a target default in `targets.mara.md`
- [ ] Print the report from `init` too, as nxr-dp5q0f planned, next to its report of tools (`nx-rust/src/generators/init/report.ts`), with `DES-GENERATORS` and `VER-SETUP` extended after the user agrees

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
