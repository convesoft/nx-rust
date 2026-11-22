---
title: Unify Rust-to-npm multi-package binary distribution in the plugin (after 1.0)
status: draft
type: feature
priority: deferred
tags:
  - deferred
  - backlog
created_at: 2026-11-22T12:05:52Z
---

Cites: `ADR-V1-SCOPE`, `ADR-SINGLE-MACHINE`, `DES-RELEASE`, `DES-NAPI`, `DES-WASM`.

A candidate for the first minor after 1.0 (1.1). Filed on 22 November 2026 at the maintainer's request; it is a draft and starts only when the maintainer says so.

## Goal

Evaluate, and if it holds up, move into `@convesoft/nx-rust` the parts of publishing a Rust crate to npm as a set of packages that `zban` and `mara` both implement on their own: per-platform binary packages plus a main dispatcher package, published in order with OIDC.

## Context

Both repositories are adopting `@convesoft/nx-rust` and ship the same npm distribution shape:

- per-platform binary packages, each with `os`, `cpu` and `libc`, a `bin`, the licences, and a `version` taken from `Cargo.toml`;
- a main dispatcher package whose `optionalDependencies` pin the platform packages to the exact version.

They sit at the two ends of what the shape has to carry:

- `zban`: one static CLI binary (musl Linux and macOS) behind a pure CommonJS shim.
- `mara`: several artifacts in one package set: the CLI, an N-API `.node` addon, WASM, JS/TS entry points, glibc Linux.

The maintainer decided not to hold 1.0 for this. The flow is implemented in `zban` and in `mara` first, and the common parts are extracted into the plugin afterwards, from what those two implementations show to be the same and what differs.

`ADR-V1-SCOPE` leaves publishing npm packages for napi, wasm and binary crates out of v1, and the plugin's `nx-release-publish` runs `cargo publish` only (`DES-RELEASE`). So this work starts in Mara: a need and a decision that change the scope, agreed with the maintainer, before any design or code.

## Candidate scope, to evaluate once both implementations exist

1. Generating the manifests and packing the platform packages and the main package. It has to allow extra files and entry points of the repository's own, for a package like `mara`'s, next to a default CLI shim, for a package like `zban`'s.
2. Ordered, resumable OIDC publishing of a folder of packed `.tgz` files:
   - check the inventory against the version in `Cargo.toml`;
   - skip a tarball that is already published with the same `dist.shasum`, so that a rerun after a partial failure works;
   - publish the platform packages first, with `--access public --provenance --tag <tag>`;
   - poll `npm view` until every platform package is visible;
   - publish the main package last.

   Tested end to end against the local registry (Verdaccio) in `nx-rust-e2e`.
3. Not in the plugin: the build matrix across operating systems (`ubuntu` and `macos` runners, moving artifacts between jobs, `cargo-about`, `gh release upload`). It stays in GitHub Actions, since the plugin runs on one machine per invocation (`ADR-SINGLE-MACHINE`).

## Tasks

- [ ] Wait until the npm distribution flow runs in production in both `zban` and `mara`, and compare the two: what is identical, what varies per repository
- [ ] Propose a draft need and a decision in Mara that change `ADR-V1-SCOPE` for npm publishing of napi, wasm and binary packages, and get the maintainer's agreement
- [ ] Decide the split between packing (item 1) and ordered publishing (item 2), and whether each is an executor, a generator or part of `nx release`; record it as design and verification items
- [ ] Break the agreed scope into issues under a 1.1 milestone epic

Done when: the maintainer has decided, from the comparison of the two implementations, what enters the plugin; the Mara items record it; and the implementation issues exist under a 1.1 epic.
