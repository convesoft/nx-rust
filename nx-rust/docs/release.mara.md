# Releasing

> **Status:** not specified yet. Planned for milestone 0.5. Release is in scope
> for v1, but its mechanism has not been designed; the items below record what
> is known.

The aim is that a repository which versions and publishes its JS packages with
[Nx release](https://nx.dev/features/manage-releases) can release its crates
through the same commands:

```sh
nx release version
nx release publish
```

What is already decided:

- A crate whose manifest sets `publish = false` gets no release targets
  ([[REQ-INFERRED-TARGETS]]).
- Publishing is never cached ([[DES-OUTPUTS]]).
- Publishing the napi and wasm packages to npm is not part of v1
  ([[ADR-V1-SCOPE]]).

## Requirements

:::mara requirement REQ-RELEASE
:mid: 01M78FHG7F358GRCJTK5Y6AQMR
:title: Version and publish crates through Nx release
:status: draft
:satisfies: NEED-RELEASE

Nx release can bump the version of a crate in its `Cargo.toml`, update the version requirements of the workspace crates that depend on it, keep `Cargo.lock` consistent with the new versions, and publish the crates in dependency order.

Open: everything about the mechanism. The design discussion of 12 November 2026 named the area without choosing one.
:::

## Design

:::mara design DES-RELEASE
:mid: 01M78FHG7F65ZV4NB8NPNJGH1T
:title: Release flow
:status: draft
:satisfies: REQ-RELEASE

To be specified. Points the design has to cover:

- An Nx release `VersionActions` implementation for `Cargo.toml`. `@monodon/rust` 3.0.0 is the reference for one.
- Version bumps of dependents, including versions inherited from `[workspace.package]` and `[workspace.dependencies]`.
- Updating `Cargo.lock` after a bump.
- Publish order, and waiting for a published crate to become available before its dependents are published.
- The dependency on the [[TERM-HACK-CRATE]] when the workspace uses cargo-hakari ([[DES-UNIFICATION]]).
- Publishing napi and wasm packages to npm, which is outside v1.
:::
