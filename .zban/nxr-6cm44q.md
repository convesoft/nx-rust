---
title: Mention the lockfile task where items still say crate targets depend on nothing
status: todo
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-gdt96k
discovered_from: nxr-pn1hwr
created_at: 2026-11-13T12:00:10Z
---

Goal: the accepted items that nxr-pn1hwr was not asked to change agree with the `lockfile` task of `DES-LOCKFILE-HASHING`.

nxr-pn1hwr changed only the items the maintainer's answers named. These still read as if crate targets had no task dependency at all, or leave the `lockfile` task out of a list:

- `DES-OUTPUTS` and the "What is stored" table in `nx-rust/docs/caching.mara.md` do not list the `lockfile` task, which is cached and stores the crates' digests.
- `ADR-NO-RUST-BUILD-DEPS` says a crate's `build` declares no dependencies; it now depends on its workspace's `lockfile` task.
- `ADR-ALL-DEP-KINDS` and the "Cycles" paragraph of `DES-PROJECT-GRAPH` say the plugin's targets declare no dependencies between crates. Where the root manifest is a package, the `lockfile` task is a target of the root crate's project. Pull request #11 (nxr-gdt96k) also changes `DES-PROJECT-GRAPH`, so do this after it has merged.

- [ ] Add the `lockfile` row to `DES-OUTPUTS` and to the "What is stored" table
- [ ] Bring the sentences above in line with the exception in `REQ-NO-RUST-TASK-DEPS`

Done when: the items agree with `DES-LOCKFILE-HASHING`, and `mara schema validate` and `mara project validate` report `valid: true`.
