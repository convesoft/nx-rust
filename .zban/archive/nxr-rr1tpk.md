---
title: Stop counting a virtual workspace's project below a paths folder as a redirected crate
status: done
type: bug
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-8sf4xw
created_at: 2026-11-14T09:35:21Z
closed_at: 2026-11-14T10:09:19Z
---

Goal: the redirected crates of a `paths` entry are crates, as `DES-PROJECT-GRAPH` ("Redirected crates") and `DES-METADATA-REPORT` ("Crates below a `paths` folder") say, and no workspace project of a virtual root manifest.

Found while fixing nxr-8sf4xw. `redirectedCrates` in `nx-rust/src/graph/redirected-uses.ts` takes, for a `paths` entry, every folder at or below the entry's folder that a report describes *or that has an Nx project*, and that holds a `Cargo.toml`. A virtual workspace at or below that folder has a workspace project in its root folder and a `Cargo.toml` there, so it becomes a redirected crate with a project but no package. Every member that may use the redirected crates then gets an edge to that workspace project, or its folder as an input where the edge is left out. Discovery's own walk already leaves such a folder out (`noCrate` in `readPathDependencies`, `nx-rust/src/graph/discovery.ts`); the older filter over project roots does not. This predates nxr-8sf4xw and only adds invalidation and edges, so the cache stays correct (`GOAL-TRUSTED-CACHE`), but `nx graph` shows edges from members to a workspace project that cargo never builds.

Reproduction to check: in `patched-workspaces`, set `paths = ["../shared"]` in `rust/.cargo/config.toml` (`shared/` is a virtual workspace with the project `shared`) and look for an edge from `api` to `shared`.

- [x] Confirm the edge with a fixture test
- [x] Leave out a folder whose report shows a virtual manifest, and update `VER-GRAPH` if it needs a sentence

## Summary of Changes

Taken into pull request #68 at the control plane's request. It is the same `paths` handling that nxr-8sf4xw rewrote, and the fix is one filter.

The older filter in `redirectedCrates` (`nx-rust/src/graph/redirected-uses.ts`) took every folder at or below a `paths` folder that a report describes, or that has an Nx project. It now also leaves out a folder whose report shows a virtual manifest: a report's root folder where no report describes a package (`virtualRoots` in `redirectedUses`). Discovery's walk already left such a folder out. A crate that another plugin entry gives a project still counts, because no report of this entry shows it to be virtual.

Mara: one sentence in `DES-PROJECT-GRAPH` ("Redirected crates": a folder whose report shows a virtual manifest holds no crate, also where a workspace project lies there) and one in `VER-GRAPH`.

Checks run:

- Confirmed the edge first: with `paths = ["../shared"]` in `patched-workspaces`, `api`, `harness`, `model`, `util` and `viaw` had edges to the workspace project `shared`.
- New test in `redirections.spec.ts`, "go to no workspace project of a virtual workspace below the folder of a paths entry": the edges equal the committed fixture's, and no member has `shared/**/*` among its inputs.
- Graph comparison before and after the filter, covering edges, target inputs, named inputs and per-input hash details of every task, for every fixture plus the `paths` variants of #63 and nxr-8sf4xw. Everything is identical apart from the harness's per-run `nx.json`. Only the issue's own shape changed: it lost its five edges to `shared`.
- With the filter alone, `pnpm nx run-many -t build lint test` passed: 1036 tests, plus 1 todo that was already there.
- After the review fixes of #68 and the merge of `main` (ee7cf38), all of these passed: `redirections.spec` (56 tests), `cache-keys.spec` (87), `pnpm nx run-many -t build lint test` (33 suites, 1122 tests, plus the todo that was already there), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`.
