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

The control plane settled the decision under the maintainer's standing instruction: the plugin skips, by itself, every manifest in a folder that a `[source.<name>]` table's `directory` names in the configuration files it reads for a workspace. Recorded as `ADR-SKIP-SOURCE-DIRECTORIES`, supported by `EVD-CARGO-REDIRECTIONS` (new "Vendoring, both placements" bullet); amended `DES-DISCOVERY`, `DES-METADATA-REPORT`, `REQ-SKIP-CRATES` (now also names vendored crates) and `VER-GRAPH`, and the guidance in `workspaces.mara.md` and `configuration.mara.md`, which says what a user sees when the `[source]` tables are not committed and what to do.

- `nx-rust/src/cargo/redirections.ts` also reads the `directory` of every `[source.<name>]` table from the configuration files it already reads, and `sourceDirectoryCandidates` reads them, leniently, for the folders of all handed manifests.
- `nx-rust/src/graph/discovery.ts` skips an unclaimed manifest in a source directory of a workspace found so far, without a cargo call, and reads the manifests in any candidate folder last, so that a workspace whose root lies deeper than its vendor folder is found first.
- `nx-rust/test/vendored-sources.spec.ts` publishes two crates with `cargo package` to a `file://` git-index registry (1.91.0's `cargo vendor` fails on a `local-registry` source), vendors them into fixture copies and checks both placements, the Cargo home's configuration and both controls; `redirections.spec.ts` covers the reader.

Checks run, on `main` at 65d5338 merged in: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` (valid, complete evaluation, 0 errors, 0 warnings) and `zban check`; the new, redirection and discovery specs also with Cargo 1.91.0 as the default toolchain. CI on the pull request covers the remaining runs.

Not changed: a path dependency into a vendor folder still requests a report, which is the case of nxr-m60y0c.
