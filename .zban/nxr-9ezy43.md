---
title: Keep the crates that cargo vendor writes out of the project graph
status: todo
type: bug
tags:
  - spec
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:11:11Z
---

Goal: a repository that commits the output of `cargo vendor` gets a working graph, or a message that says what to do, and vendored crates never become projects.

Nx hands every `Cargo.toml` under the vendor folder to the plugin unless `.gitignore`, `.nxignore` or `exclude` on the plugin's entry leaves it out (`DES-DISCOVERY`). `EVD-CARGO-REDIRECTIONS` (vendoring) records that `cargo metadata --no-deps` in a vendored crate's folder inside a workspace folder fails with "current package believes it's in a workspace when it's not", so graph creation fails with the existing error, which suggests `exclude`. Outside every workspace folder, each vendored crate would presumably become a standalone crate with a project of its own; not checked.

Vendored crates need no edges: cargo builds them as packages of the registry that the `[source]` replacement points at, refuses an edited vendored file because of its checksum, and `Cargo.lock` holds their checksums (`DES-LOCKFILE-HASHING`).

- [ ] Check what the plugin does with a vendor folder inside a workspace folder and with one outside every workspace folder, as `cargo vendor` writes them
- [ ] Decide with the user whether the plugin skips the folders that a `[source]` replacement's `directory` names, or only documents `exclude`, and record it in Mara
- [ ] Implement it, with a fixture

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
