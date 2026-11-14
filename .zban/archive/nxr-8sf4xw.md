---
title: Reach a crate with a project behind a crate deeper below a paths folder
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-vaywmh
created_at: 2026-11-14T07:59:39Z
closed_at: 2026-11-14T09:39:45Z
---

Goal: a member that may use a crate without a project which lies deeper below the folder of a `paths` entry, not in that folder itself, hashes the crates with a project that this crate depends on by path, and `nx affected` selects the member when they change (`GOAL-TRUSTED-CACHE`, `DES-PROJECT-GRAPH` "Redirected crates", `DES-METADATA-REPORT`).

Found while fixing nxr-vaywmh. Behind a redirected crate without a project, a member now gets an edge to each crate with a project that cargo builds with it. That needs the redirected crate's report. Discovery requests one for a `[patch]` or `[replace]` crate and for a crate whose `Cargo.toml` lies in the folder of a `paths` entry itself, but not for a crate deeper below that folder (`readPathDependencies` in `nx-rust/src/graph/discovery.ts`; `DES-METADATA-REPORT` says so). Cargo takes `paths` crates from anywhere below the folder (`EVD-CARGO-REDIRECTIONS`: `paths = ["local"]` took `model` from `local/inner/model`). `redirectedCrates` in `nx-rust/src/graph/redirected-uses.ts` then only knows the folder, whose fileset covers the crate's own files but not the crates with a project behind it.

Reproduction, checked on the branch of nxr-vaywmh: in `patched-workspaces`, make `third_party/fork` depend on `plain = { path = "../../rust/crates/plain" }` in place of `model = "0.1"`, drop `fork` from `rust/Cargo.toml`'s `[patch.crates-io]` and add `paths = ["../third_party"]` to `rust/.cargo/config.toml`. Only `rust` has an edge to `plain`; `api`, which may use `fork`, has none.

Finding those crates means looking for manifests below the folder, as cargo does, which graph creation does nowhere else. Settle in Mara first how far it looks (ignored folders, `target` directories, nested workspaces) and what it costs.

- [x] Decide how discovery finds the crates below a `paths` folder, and update `DES-METADATA-REPORT`, `DES-PROJECT-GRAPH` and `VER-GRAPH`
- [x] Implement it, with the reproduction above as a test with the real hasher and `nx affected`

## Summary of Changes

Decided by the control plane under `GOAL-TRUSTED-CACHE`: follow cargo, and where cargo's rule cannot be reproduced exactly, find more crates rather than fewer. Only repositories that configure `paths` pay for the walk. It is bounded, and it stays out of what cargo skips, out of `node_modules` and out of Cargo's artifact directories. Each crate found gets the report that a crate directly in the folder gets since #63. A crate that cargo cannot load gives the existing warning. With the daemon, a manifest added later inside the repository is noticed.

Cargo's rule, from experiments with cargo 1.100.0 and 1.91.0 (identical results) and from `read_packages`/`walk` in `src/cargo/sources/path.rs` of cargo 0.92.0, recorded in `EVD-CARGO-REDIRECTIONS`:

- Cargo walks to any depth and takes every folder holding `Cargo.toml`, going on below crates and nested workspaces.
- Below the folder itself it skips hidden folders and folders holding `.git`. At every level it skips `target` beside a `Cargo.toml`.
- It follows a link given as the folder, and no link below it. It skips unreadable folders.
- A manifest it cannot parse is skipped, unless the folder holds no crate at all.
- Of two crates with one name it takes the first in walk order.
- It also takes the path dependencies of every crate it finds.

The plugin follows this in `cratesBelowPathsFolder` (`nx-rust/src/cargo/paths-crates.ts`), once per folder (`pathsFolderCrates` in `discovery.ts`). Beyond cargo, it does not enter `node_modules`, folders whose `CACHEDIR.TAG` says cargo created them, or the discovered workspaces' artifact and build directories. Where it can't follow cargo exactly, it finds more: both of two crates with one name, and folders whose manifests cargo cannot parse. The path dependencies cargo also takes are reached through the walk from each found crate. A folder whose report shows a virtual manifest is dropped. None of these choices needed a new product decision.

Cost: walking a folder with 440 folders below it (40 crates, `target` folders, a `node_modules` folder) took 2–5 ms (median 3 ms). On top of that comes one `cargo metadata --no-deps` call, about 6–9 ms here, for each crate without a project that no other report covers. A nested workspace's members share one report. Repositories without `paths` walk nothing.

Daemon: a `Cargo.toml` added below a `paths` folder inside the repository is a change that the daemon sees. The daemon then runs `createNodes` again, and the walk finds the new crate. This holds even where the plugin's `exclude` keeps that manifest away from `createNodes`, since the daemon recomputes after any change it sees. A folder outside the repository, or one that Nx ignores, is read whenever Nx creates the graph, like the rest of Cargo's configuration outside the repository (`DES-METADATA-REPORT`).

Mara: `DES-METADATA-REPORT` ("Crates below a `paths` folder"), `DES-PROJECT-GRAPH` ("Redirected crates"), `EVD-CARGO-REDIRECTIONS`, `VER-GRAPH` and `VER-CACHE-KEYS`, plus the guidance in `workspaces.mara.md`.

Checks run:

- `redirections.spec.ts`: the issue's reproduction, as the row "paths, with the crate below the entry's folder", with the real hasher and `nx show projects --affected`. It gives the edges from `api`, `harness`, `lone`, `model`, `rust`, `util` and `viaw` to `plain`; their keys change and `nx affected` selects them.
- A test that each crate below the folder gets one report from `rust`, that a manifest that is no valid TOML gives the warning naming it and what to do, and that crates in a hidden folder, `node_modules` and the artifact directory get no report.
- A daemon test: a crate added below the folder after the daemon created the graph shows up in the next `nx show projects --affected`.
- Five unit tests of the walk rules.
- Without the walk, the reproduction and daemon tests fail.
- `pnpm nx run-many -t build lint test` passed: 33 suites, 1035 tests, 1 todo that was already there. So did `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`.

Filed: nxr-rr1tpk, an older quirk where a virtual workspace's project below a `paths` folder counts as a redirected crate. It only adds edges.

## Changes after the review of pull request #68

The control plane decided both fixes after the review at 0deced2. They replace two points of the summary above.

1. **The walk skips exactly what cargo skips.** The extra skips of `node_modules`, folders with cargo's `CACHEDIR.TAG`, and the artifact and build directories hid crates that cargo uses. With the override at `third_party/node_modules/pkg/model` depending on `shared/plain`, a change to `plain` left all five cached hashes of `api` the same. `cratesBelowPathsFolder` now skips only hidden folders, folders holding `.git`, `target` beside a `Cargo.toml`, links below the folder, and unreadable folders. Cost: a folder holding a real `node_modules` (6,367 folders) and a Cargo artifact directory (5,005 folders) took 89–122 ms to walk, recorded in `EVD-CARGO-REDIRECTIONS` and `DES-METADATA-REPORT`.
2. **The crates that a `paths` entry can redirect to include the path dependencies of the crates found.** Cargo takes them of every kind (dev-dependencies and other platforms included), to any depth, inside or outside the folder. I checked a dev-, build- and other-platform dependency and two dev-dependencies deep, on 1.100.0 and 1.91.0. `pathsCandidates` in `discovery.ts` is a walk of its own, kept apart from the normal-and-build walk that says what cargo builds with a crate (`DES-METADATA-REPORT`). Consequence: `paths = ["crates/model"]` in `patched-workspaces` also gives `api` and `viaw` edges to `util` and `harness`. `harness` then hashes model's files in place of its edge to `model`, because the two may only possibly use each other.
3. **Warning for a crate that cargo refuses to report.** No code change was asked for, only the warning text. It now says in plain words that the crates behind the crate are not followed, and that letting cargo report it or declaring their files with `fileInputs` covers them. Its tests assert the sentences, including one for such a crate below a `paths` folder.

Tests added: the reviewer's cases, as rows with the real hasher and `nx show projects --affected` in `redirections.spec.ts`. They cover the crate in `node_modules`, in a cargo-tagged cache folder, in the artifact directory and in the build directory, plus a dev-dependency outside the folder. The reviewer's scripts `paths.cjs` and `dev-path.cjs`, run from a copy, now give `api → plain` with all five hashes changed and `api` selected, for every shape where cargo uses the crate.

After merging `main` at cd8c0fd (#66), these passed on the merged tree: `redirections.spec` (56 tests), `cache-keys.spec` (96), `pnpm nx run-many -t build lint test` (35 suites, 1152 tests, plus the todo that was already there), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`.
