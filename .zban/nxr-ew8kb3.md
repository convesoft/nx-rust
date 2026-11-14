---
title: Detect crates whose executables share a file name in one artifact directory
status: todo
type: bug
parent: nxr-9y4eh8
discovered_from: nxr-1q1f0n
created_at: 2026-11-14T17:36:18Z
---

Goal: no `build` task can store another crate's executable under its key because two crates of one artifact directory have binaries with the same file name (`GOAL-TRUSTED-CACHE`).

Context: `RISK-ARTIFACT-DIR-WRITERS` ("Executables with one file name") and `EVD-CARGO-ARTIFACT-WRITERS`: cargo writes the binaries of both crates to the same path, warns of an output filename collision when one call builds both, and the file is that of the crate it built last. `DES-OUTPUTS` declares that path as an output of each crate's `build`, so either entry can hold the other crate's executable whatever the order of tasks. `DES-BUILD-INPUT-CHECK` already leaves such shared record names unread (`sharedRecordNames` in `nx-rust/src/graph/build-records.ts`). Ordering tasks cannot fix it: it needs a rule when the graph is created.

Decided by the control plane on 14 November 2026, recorded in `RISK-ARTIFACT-DIR-WRITERS`: the `build` targets of crates whose executables share a file name in one artifact directory are left uncached, with a keyed project warning that names the crates and the file and says to rename one binary. Graph creation does not fail: cargo itself builds such a workspace, with its own warning, and the plugin must not make a valid Cargo workspace unusable (`REQ-CARGO-UNCHANGED`), while an uncached `build` can store no wrong entry (`GOAL-TRUSTED-CACHE`).

- [ ] Reproduce with two crates of one workspace, and of two workspaces with one artifact directory, whose binaries share a name
- [ ] Write the rule into the design: a reason in `cargo.uncached` (`DES-OUTPUTS`, "Per project"), the warning row in `DES-DIAGNOSTICS` (a project warning whose digest the keys hold, "Warnings where they are seen"), and a check in `VER-CARGO-UNCHANGED`
- [ ] Implement it at graph creation, for crates of one workspace and of several workspaces that share an artifact directory, with tests that the colliding `build` targets are uncached and warn, that the other targets and crates stay cached, and that graph creation succeeds
- [ ] Update `RISK-ARTIFACT-DIR-WRITERS` ("Executables with one file name") once implemented

Done when: the decided rule is accepted in Mara, implemented and tested, and `mara project validate` reports `valid: true`.
