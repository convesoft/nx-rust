---
title: Design the strict per-crate build check of the hakari strategy
status: todo
type: feature
priority: deferred
tags:
  - backlog
discovered_from: nxr-k64tm5
created_at: 2026-11-16T16:34:58Z
---

Goal: the optional strict per-crate build target of `DES-UNIFICATION` ("Masked missing features") exists, so that a crate that stopped declaring a feature it needs because the hack crate turns it on is caught.

Context: moved out of nxr-k64tm5 on 16 November 2026, because no way to build a crate without the hack crate was found that writes no manifest (`REQ-NO-MANIFEST-WRITES`, `ADR-V1-SCOPE`): `--config 'patch.<source>.<hack>.path=…'` cannot replace the hack crate, which is a member, and cargo fails with "failed to select a version" (`EVD-HAKARI-UNIFICATION`, "Without the hack crate"). cargo-hakari's own way, `cargo hakari disable` and `generate`, writes the hack crate's manifest. `DES-UNIFICATION` marks the target provisional and names this issue.

- [ ] Find a way to compile a crate without the hack crate's unification that writes no file of the repository, such as a copy of the workspace in the build directory, and record it as evidence
- [ ] Design the target with the user (name, opt-in setting, caching, inputs) in `DES-UNIFICATION` and `DES-PLUGIN-OPTIONS`, and accept it
- [ ] Implement and test it

Done when: the design is accepted and the target passes the checks that its verification names.
