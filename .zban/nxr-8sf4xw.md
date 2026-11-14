---
title: Reach a crate with a project behind a crate deeper below a paths folder
status: todo
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-vaywmh
created_at: 2026-11-14T07:59:39Z
---

Goal: a member that may use a crate without a project which lies deeper below the folder of a `paths` entry, not in that folder itself, hashes the crates with a project that this crate depends on by path, and `nx affected` selects the member when they change (`GOAL-TRUSTED-CACHE`, `DES-PROJECT-GRAPH` "Redirected crates", `DES-METADATA-REPORT`).

Found while fixing nxr-vaywmh. Behind a redirected crate without a project, a member now gets an edge to each crate with a project that cargo builds with it. That needs the redirected crate's report. Discovery requests one for a `[patch]` or `[replace]` crate and for a crate whose `Cargo.toml` lies in the folder of a `paths` entry itself, but not for a crate deeper below that folder (`readPathDependencies` in `nx-rust/src/graph/discovery.ts`; `DES-METADATA-REPORT` says so). Cargo takes `paths` crates from anywhere below the folder (`EVD-CARGO-REDIRECTIONS`: `paths = ["local"]` took `model` from `local/inner/model`). `redirectedCrates` in `nx-rust/src/graph/redirected-uses.ts` then only knows the folder, whose fileset covers the crate's own files but not the crates with a project behind it.

Reproduction, checked on the branch of nxr-vaywmh: in `patched-workspaces`, make `third_party/fork` depend on `plain = { path = "../../rust/crates/plain" }` in place of `model = "0.1"`, drop `fork` from `rust/Cargo.toml`'s `[patch.crates-io]` and add `paths = ["../third_party"]` to `rust/.cargo/config.toml`. Only `rust` has an edge to `plain`; `api`, which may use `fork`, has none.

Finding those crates means looking for manifests below the folder, as cargo does, which graph creation does nowhere else. Settle in Mara first how far it looks (ignored folders, `target` directories, nested workspaces) and what it costs.

- [ ] Decide how discovery finds the crates below a `paths` folder, and update `DES-METADATA-REPORT`, `DES-PROJECT-GRAPH` and `VER-GRAPH`
- [ ] Implement it, with the reproduction above as a test with the real hasher and `nx affected`
