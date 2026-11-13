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
- [ ] Report a target default that replaces a crate target's `dependsOn`, which drops the dependency on the workspace's `lockfile` task and with it the lockfile digest from the key (`DES-LOCKFILE-HASHING`, "Excluded dependencies")
- [ ] Document narrowing a target default in `targets.mara.md`
- [ ] Consider in the requirement an entry that sets `cache: true` on an inferred Rust target, keyed by the target's name or by its executor, which Nx lays over the plugin's `cache: false` (`EVD-NX-TARGET-DEFAULTS`): until nxr-fy4t4k declares the inputs, such a target would be cached with Nx's default inputs (`GOAL-TRUSTED-CACHE`; the interim rule is in the status note of `nx-rust/docs/targets.mara.md`), and on `fmt`, `bench`, `run`, `audit`, `deny` and `update` it contradicts `DES-TARGETS` for good
- [ ] Print the report from `init` too, as nxr-dp5q0f planned, next to its report of tools (`nx-rust/src/generators/init/report.ts`), with `DES-GENERATORS` and `VER-SETUP` extended after the user agrees

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
