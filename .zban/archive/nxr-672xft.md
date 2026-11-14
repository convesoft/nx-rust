---
title: Decide whether publishing also stops for dependencies on other crates with publish = false
status: done
type: task
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-k4c6ek
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:49:06Z
closed_at: 2026-11-14T16:27:11Z
---

Goal: a maintainer decision on whether the early failure of `DES-RELEASE` (`nx-rust/docs/release.mara.md`, Hack crate) covers more than the cargo-hakari hack crate.

The maintainer chose on 14 November 2026 that publishing a crate that depends on a hack crate with `publish = false` fails before cargo runs. The same mechanism applies to any crate of the repository with `publish = false` that a published crate names, as a normal or build dependency, with a version requirement: cargo packages that dependency for the registry, so it fails where the registry has no crate of that name and resolves to an unrelated crate where the registry has one (`EVD-CARGO-PUBLISH`: the measurements on dependencies when publishing, and the cargo-hakari bullet for the name `workspace-hack` on crates.io). Without a version requirement cargo refuses to publish such a crate itself, with its own message.

- [x] Decide: extend the early failure to every such dependency, or keep it to the hack crate and leave the rest to cargo. Decided by the control plane (extend), the maintainer told rather than asked
- [x] Update `DES-RELEASE`, the user guidance of `release.mara.md` and `VER-RELEASE` group 8 accordingly, and the step on nxr-k4c6ek

Done when: the maintainer has chosen, the items are updated, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

Decided by the control plane on 14 November 2026, after the review of the release specification, as a consequence of the maintainer's answer "Fail early with guidance (Recommended)"; the maintainer is told, and was not asked. The early failure covers every normal or build dependency, with a version requirement, on a crate of the repository that is not published to the registry of the call, through `publish = false` or a `publish` list without that registry, not only the hack crate. The reason: cargo packages such a dependency for the registry whatever its `publish` says, so it fails where the registry has no crate of that name and resolves to an unrelated crate where it has one. The hack crate keeps its own guidance (cargo-hakari's two ways).

Settled on the branch of nxr-5fp9d3 (`docs/specify-release-flow`), not in a branch of its own:

- `DES-RELEASE`: the check _Unpublished dependencies_ of "Checks before each call", recorded as the control plane's decision; the Hack crate paragraph now refers to it. `REQ-RELEASE` states the failure for every such dependency.
- `release.mara.md` guidance: the section "Dependencies that are not published".
- `VER-RELEASE` group 8: `publish = false` and a `publish` list without the registry, also with an unrelated crate of that name in the registry, and the hack crate.
- nxr-k4c6ek carries the step and is renamed to cover every such dependency.
- `EVD-CARGO-PUBLISH`: reproduced on cargo 1.100.0 and 1.91.0 against a local registry: without a crate of that name, `cargo publish --dry-run` failed with "no matching package named"; with an unrelated crate of that name and version in the registry, `cargo publish` uploaded the dependent with a requirement on it, for `publish = false` and for `publish = ["other-registry"]` alike.

Checks: `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `pnpm nx format:check --all` and `zban check` on that branch. No test suite ran: knowledge and issues only.
