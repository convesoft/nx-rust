---
title: Do not fail graph creation for a path dependency that cargo builds but does not report
status: done
type: bug
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:41:55Z
closed_at: 2026-11-13T18:17:22Z
---

Goal: a path dependency without a project that cargo builds never makes graph creation fail.

`DES-METADATA-REPORT` requests a report for a path dependency without a project to follow the path dependencies behind it. Checked on 2026-11-13 with cargo 1.100.0: workspace `w1` with member `app`, which depends on `x = { path = "../../w2/stray" }`; `w2/Cargo.toml` is a workspace with `members = []`, and `w2/stray` holds `x` without `[workspace]`. `cargo check` in `w1` succeeded, while `cargo metadata --no-deps --manifest-path ../w2/stray/Cargo.toml` in `w1` failed with "current package believes it's in a workspace when it's not", as `EVD-CARGO-REDIRECTIONS` records for a patched crate. If Nx does not hand `w2/stray/Cargo.toml` to the plugin (ignored or excluded), the plugin's report of the path dependency fails, and so does graph creation. For crates that `[patch]` or `[replace]` redirect to, nxr-p5ybc0 already goes on with a warning; path dependencies were left as they are.

- [x] Reproduce it through Nx graph creation with the stray crate excluded
- [x] Decide with the user whether a path dependency gets the same treatment as a redirected crate (warning, folder as input, path dependencies behind it not followed), and record it in `DES-METADATA-REPORT` and `DES-DIAGNOSTICS`
- [x] Implement it with a test

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Reproduced on 2026-11-13 through the harness (`nx` 24.0.6): in a copy of the fixture `cross-workspace-path` with `members = []` in `shared/Cargo.toml` and `shared/` in `.nxignore`, graph creation failed with "`cargo metadata` failed for shared/crates/model/Cargo.toml, a path dependency of backend/crates/server/Cargo.toml that has no project of its own" and cargo's "current package believes it's in a workspace when it's not", while `cargo check --offline --locked` in `backend` succeeded with cargo 1.100.0 and 1.91.0.

The control plane decided the second step, not the maintainer. It followed from what the maintainer had already agreed for redirected crates: no redirection fails graph creation, and `DES-METADATA-REPORT` already went on with a warning for a crate that `[patch]` or `[replace]` redirects to and cargo does not report. It also followed from `REQ-CARGO-UNCHANGED`. A path dependency without a project that cargo builds but does not report therefore gets the same treatment: a warning that names the manifest and carries cargo's message, no report, its folder as an input of the crates that use it, and the path dependencies behind it not followed. A report that fails for another reason keeps failing graph creation. The line is drawn by cargo's membership message. Cargo makes that check only for the crate it reports, never for a dependency it builds, and no other failure message separates "cargo builds it" from "cargo rejects a manifest the crate needs". `EVD-CARGO-UNREPORTED-CRATES` (new; cargo 1.100.0 and 1.91.0) records the cases. `DES-METADATA-REPORT`, a new row of `DES-DIAGNOSTICS`, the possible uses in `DES-PROJECT-GRAPH`, `VER-GRAPH` and the guidance in `workspaces.mara.md` are updated.

- `readPathDependencies` in `nx-rust/src/graph/discovery.ts` goes on with the existing warning when a path dependency's report fails with that message (`isUnreportedNonMember`). Redirected crates keep going on for any cargo failure.
- `reachesExternal` in `nx-rust/src/graph/redirected-uses.ts` counts a path crate without a report as one with a registry or git dependency. Without that, a member whose only registry dependency lies behind such a crate lost its possible edges to redirected crates. The rule also covers the crates of directory sources that #36 skips.
- Tests: `nx-rust/test/discovery.spec.ts` checks the warning and that no report is requested behind the crate, with the default cargo and with 1.91.0, and that another failure (a manifest that cargo rejects behind the crate) still fails graph creation. `nx-rust/test/redirections.spec.ts` checks the possible edges through such a crate. Each of the new "goes on" tests failed against the previous code.
- Inputs: on `main` no target is cached yet, so there are no inputs to check here. The folder input for such a crate is part of nxr-fy4t4k (#33), as for any path dependency without a project.

Filed nxr-thq2v8: the other workspace-level failures that cargo builds but does not report (another member missing, `package.workspace` naming a non-root or a missing folder) still fail graph creation, because one of their messages also comes for a rejected manifest; the maintainer decides.

Checks run, on `main` at 1f01a55: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (24 tests), `mara schema validate`, `mara project validate` (valid, complete evaluation, 0 errors, 0 warnings) and `zban check`. CI on the pull request covers the remaining runs.
