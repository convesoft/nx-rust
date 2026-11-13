---
title: Specify build-script and macro inputs
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T12:06:21Z
---

Goal: turn the draft item `REQ-BUILD-SCRIPT-INPUTS` (`nx-rust/docs/caching.mara.md`) into accepted knowledge with a design, or record why it stays out of v1. It mitigates `RISK-UNDECLARED-INPUTS`.

- [x] Answer the open questions in the item with the user: how the plugin learns `rerun-if-changed` and `include_str!` paths outside the crate's folder without running the build, and what happens on the first run
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer answered the open questions on 2026-11-13: files outside a crate are declared in Cargo metadata under `fileInputs`, not learned from builds; nothing special happens on the first run; a pattern Nx cannot hash fails graph creation; a `build` that read an uncovered repository file fails; accepted items get additions only.

- `REQ-BUILD-SCRIPT-INPUTS` rewritten in its declared form and accepted; its `Open:` paragraph is gone.
- New and accepted: `REQ-FILE-INPUTS-HASHABLE` (the graph-time rejection of patterns Nx cannot hash, split off from `REQ-BUILD-SCRIPT-INPUTS`), `REQ-BUILD-INPUT-CHECK`, `DES-BUILD-INPUT-CHECK`, `ADR-DECLARED-FILE-INPUTS` (with the rejected alternatives), `EVD-CARGO-DEP-INFO` (cargo 1.100.0 and 1.97.1 experiments) and `EVD-NX-24-FILE-INPUTS` (Nx 24.0.6 experiments and reading), and `VER-BUILD-INPUT-CHECK`.
- Additions to accepted items: a "Declared files" row and paragraph in `DES-INPUTS`, a `fileInputs` row in `DES-METADATA-TABLES`, two rows in `DES-DIAGNOSTICS` and a sentence on cached failures in its "Errors" paragraph, `RISK-UNDECLARED-INPUTS` rewritten to say what remains, `VER-CACHE-KEYS` extended to verify `REQ-BUILD-SCRIPT-INPUTS` and `REQ-FILE-INPUTS-HASHABLE`, `fileInputs` added to the tags exception of `REQ-METADATA-OVERRIDES` and `VER-CONFIGURATION`, and the invalid pattern added to the graph-creation errors that `VER-SETUP` lists.
- After review: the check runs after every cargo build of the crate that succeeds, fresh ones included, because the records are present then whatever their time. It reads the records that `cargo build -p <crate>` exports (libraries that are only an `rlib` included), named without any added cargo flag from the metadata report and the task's features, profile and triple; the rule agreed with cargo's own messages in thirteen builds. It reads no record it cannot name with certainty: a triple from Cargo's configuration, a name two crates share, and binaries turned on by another crate's features are skipped. It resolves recorded paths (links followed, case as on disk), compares them with Nx's matching of the task's inputs, and counts a file reached only through a declared link as uncovered. It enumerates a recorded directory while pruning Cargo's directories and what Nx ignores. A declared file that the root `.gitignore` or `.nxignore` ignores is in the key, but a change to it alone makes no task affected; a declared symbolic link keeps the hash of its destination until the link itself changes. Whether a failure is cached depends on `NX_CACHE_FAILURES`; a success is never cached for the incomplete key. Each of these was reproduced with cargo 1.100.0 (some also with 1.98.1 and 1.97.1) or Nx 24.0.6 and recorded in `EVD-CARGO-DEP-INFO` or `EVD-NX-24-FILE-INPUTS`; the case rule for macOS is reasoned, not run.
- Guidance: a "Files outside the crate" section in `caching.mara.md`, and `fileInputs` in `configuration.mara.md`.
- Third review: a proc macro's library record lies in the host profile folder whatever the triple, and the guard for a triple from Cargo's configuration does not apply to it; `test` and `bench` write to `debug` and `release`, and a custom profile to its own name whatever it inherits; a record at a derived name and folder is the call's own because cargo rewrites a record whose content differs also when nothing compiles, so stale records elsewhere are never read. A matrix of eight crate kinds, eight profiles and five triple modes compared the naming rule with cargo's own messages on cargo 1.91.0 and 1.100.0: every build agreed except those where Cargo's configuration chose the triple, which the guard skips, and a `cdylib`-only crate for musl, which cargo refuses to build. The link sentences now say that `nx reset` also makes Nx read a link's destination again. Merged `main` with the option reference (#16): `fileInputs` is a row of `DES-PLUGIN-OPTIONS` (the two metadata tables, no default, adding up), every sentence on settings that add up names tags, `implicitDependencies`, `fileInputs`, `envInputs` and `runtimeInputs`, and the guidance on negated patterns says which exclusions the check catches.
- Follow-ups: nxr-d371vy (hash declared files), nxr-agyqmz (the post-build check), nxr-d0et9v (the check in a batch, 0.2), nxr-j25xwy (spike on Nx Cloud's `ultracache`). nxr-tv3r95 and nxr-0ap8n4 each got a step to run the check after their compile step.

Checks run on the final commit: `mara schema validate` (valid), `mara project validate` (valid: true, evaluation complete, 0 errors, 0 warnings), `zban check` (no findings), `pnpm nx run-many -t build lint test` (passed), `pnpm nx format:check --all` (passed).
