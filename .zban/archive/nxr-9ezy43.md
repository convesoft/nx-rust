---
title: Keep the crates that cargo vendor writes out of the project graph
status: done
type: bug
tags:
  - spec
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:11:11Z
closed_at: 2026-11-13T17:02:26Z
---

Goal: a repository that commits the output of `cargo vendor` gets a working graph, or a message that says what to do, and vendored crates never become projects.

Nx hands every `Cargo.toml` under the vendor folder to the plugin unless `.gitignore`, `.nxignore` or `exclude` on the plugin's entry leaves it out (`DES-DISCOVERY`). `EVD-CARGO-REDIRECTIONS` (vendoring) records that `cargo metadata --no-deps` in a vendored crate's folder inside a workspace folder fails with "current package believes it's in a workspace when it's not", so graph creation fails with the existing error, which suggests `exclude`. Outside every workspace folder, each vendored crate would presumably become a standalone crate with a project of its own; not checked.

Vendored crates need no edges: cargo builds them as packages of the registry that the `[source]` replacement points at, refuses an edited vendored file because of its checksum, and `Cargo.lock` holds their checksums (`DES-LOCKFILE-HASHING`).

- [x] Check what the plugin does with a vendor folder inside a workspace folder and with one outside every workspace folder, as `cargo vendor` writes them
- [x] Decide with the user whether the plugin skips the folders that a `[source]` replacement's `directory` names, or only documents `exclude`, and record it in Mara
- [x] Implement it, with a fixture

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Reproduced on 2026-11-13 with a real `cargo vendor` (cargo 1.100.0 and 1.91.0, `nx` 24.0.6) from a registry outside the repository: a vendor folder inside a workspace's folder made graph creation fail with cargo's "current package believes it's in a workspace when it's not"; one outside every workspace's folder gave each vendored crate a standalone project.

The control plane settled the rule under the maintainer's standing instruction. A first rule (skip the folders that a `[source]` table's `directory` names) was dropped in review, because it removed real crates whose folder a `[source]` table named, and failed for a plugin entry that receives only the vendor folder. The rule now is cargo's own marker: a crate whose folder holds `.cargo-checksum.json`, which `cargo vendor` writes for every crate it vendors and without which cargo refuses a directory-source package (both checked on 1.91.0 and 1.100.0), gets no project, no edge and no cargo call, unless a workspace's report lists it as a member, as cargo enrols one used by path. A path dependency on such a crate that is no member gets no report. Recorded as `ADR-SKIP-VENDORED-CRATES` with the reason the first rule was dropped, supported by `EVD-CARGO-REDIRECTIONS` (two new bullets: the vendoring runs and the review's reproduction); amended `DES-DISCOVERY`, `DES-METADATA-REPORT`, `REQ-SKIP-CRATES` and `VER-GRAPH`, and the guidance in `workspaces.mara.md` and `configuration.mara.md`.

- `nx-rust/src/graph/discovery.ts`: `isDirectorySourcePackage`; discovery reads only manifests without the marker, so that a marker crate is a project only as a member of a workspace read from another manifest; the path-dependency walk requests no report for a marker crate that no report covers. `nx-rust/src/cargo/redirections.ts` is as on `main`.
- `nx-rust/test/vendored-sources.spec.ts` publishes two crates with `cargo package` to a `file://` git-index registry (1.91.0's `cargo vendor` fails on a `local-registry` source), vendors them into fixture copies and checks both placements with the printed `[source]` tables and without configuration, the marker as positive control, a crate without the marker in the vendor folder, the two-entry split, a vendored crate used by path as member and excluded, and the review's four `[source]` configurations as regressions that change nothing.

Checks run, on `main` at de8540c merged in: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` (valid, complete evaluation, 0 errors, 0 warnings) and `zban check`; the new, redirection and discovery specs also with Cargo 1.91.0 as the default toolchain. CI on the pull request covers the remaining runs.

A plugin entry that receives a vendored crate's manifest without the manifests of the workspace that lists it as a member gives it no project; not reproduced as a need.
