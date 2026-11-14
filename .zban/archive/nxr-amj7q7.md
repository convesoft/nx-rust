---
title: Decide whether publishing can reach crates.io while the Cargo configuration replaces it
status: done
type: task
priority: low
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-m8evx2
discovered_from: nxr-fwxn1r
created_at: 2026-11-14T18:22:31Z
closed_at: 2026-11-14T19:41:24Z
---

Goal: decide whether `nx release publish` can publish crates to crates.io itself from a repository whose Cargo configuration replaces crates.io, as with a crates.io mirror, and record the answer in `DES-RELEASE`.

Found while settling nxr-fwxn1r. Plain `cargo publish` refuses this case for a crate without a `publish` list unless it gets `--registry crates-io`; with `publish = ["crates-io"]` or `CARGO_REGISTRY_DEFAULT=crates-io` it goes to crates.io itself, past the replacement (`EVD-CARGO-PUBLISH-REGISTRIES`, second session). Under **Target registry** in `DES-RELEASE` (`nx-rust/docs/release.mara.md`) the executor looks versions up on crates.io with `cargo info <name>@<version> --index sparse+https://index.crates.io/ --locked`, which asks the replacement, and fails such crates before cargo runs where that lookup's first `Updating` line names a replacement, because the upload and the lookup would not ask the same registry. A lookup that asks crates.io itself under a replacement has not been found: the research for nxr-fwxn1r saw `cargo info --registry crates-io` read the replacement as well, which was not repeated, because no experiment may pass `--registry crates-io` outside a sandbox that refuses crates.io.

- [x] Find a lookup of a version that asks crates.io itself while the configuration replaces it: dropped after the maintainer's answer, which keeps failing; none is known (`EVD-CARGO-PUBLISH-REGISTRIES`)
- [x] Ask the maintainer whether v1 supports the case, and how, or keeps failing with guidance
- [x] Update `DES-RELEASE`, its user guidance and `VER-RELEASE` with the answer

Done when: the maintainer has chosen, the items are updated, and `mara schema validate` and `mara project validate` report `valid: true`.

## Maintainer's answer

14 November 2026, the option chosen, word for word: "Keep failing, with guidance (Recommended)". On a machine whose Cargo configuration replaces crates.io, a crate that would publish to crates.io fails before cargo runs and is told to publish from a job whose configuration does not replace crates.io. Not taken: passing `--registry crates-io`.

## Summary of Changes

`ADR-PUBLISH-REPLACED-CRATES-IO` records the answer word for word with the option not taken. **crates.io replaced** in `DES-RELEASE` states the failure and its guidance: the executor sees the replacement in the lookup on crates.io (`cargo info --index sparse+https://index.crates.io/`), whose first `Updating` line then names the replacement, and in cargo's refusal of a crate without a `publish` list, to which it adds the guidance; it falls under the principle of **Registries**, which the second review of nxr-fwxn1r settled in the same change. The user guide says to publish to crates.io from a job without the replacement, `DES-DIAGNOSTICS` has the row, and `VER-RELEASE` group 9 checks the failure for a crate without a list and under `CARGO_REGISTRY_DEFAULT=crates-io`. `EVD-CARGO-PUBLISH-REGISTRIES` holds the measurements on Cargo 1.100.0 and 1.91.0: a `publish = ["crates-io"]` list and `CARGO_REGISTRY_DEFAULT=crates-io` send `cargo publish` past the replacement, and the `--index` lookup follows it. The search for a lookup that asks crates.io itself under a replacement was dropped with the answer; none is known.

Checks: `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (valid, evaluation complete, no errors or warnings), `zban check`. No test run: specification only.
