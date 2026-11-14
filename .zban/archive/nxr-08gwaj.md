---
title: Reach a crate with a project that a crate reaches only through crates without a project
status: done
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-d371vy
created_at: 2026-11-13T20:38:43Z
closed_at: 2026-11-13T22:07:25Z
---

Goal: a crate that reaches a crate with a project only through path dependencies on crates without a project hashes that crate's inputs, and `nx affected` selects it when they change (`GOAL-TRUSTED-CACHE`, `REQ-INPUT-FILES`, `REQ-DEPENDENCY-EDGES`).

Found in the review of nxr-d371vy (pull request #49), reproduction `bridge.cjs` in the reviewer's folder. In the fixture `declared-files`, add the crate `rust/crates/bridge`, which depends on `api` by path and which `nx.json` excludes from the plugin. Then add the standalone crate `cross`, which depends on `bridge` by path. `cross` gets no edge to `api`. Its inputs hold `bridge`'s folder and `rust/Cargo.toml`, but nothing of `api`. A change to `api`'s source, and since nxr-d371vy to a file that `api` declares, leaves `cross:test`'s key the same: the result is restored, and `nx affected` does not select `cross`. This holds on `main` as well, with `api`'s source.

The cause: `DES-PROJECT-GRAPH` draws an edge only for a crate's own dependency on a crate with a project. `reachedWithoutProject` in `nx-rust/src/graph/path-dependencies.ts` stops at a crate with a project ("what lies behind a crate with a project reaches the crate through that project's own input"), which covers a project behind a project, but not a project behind a crate without one.

Not decided. The proposal is an edge from the crate to each crate with a project that it reaches through path dependencies on crates without a project, of the kinds cargo builds for it. Then `^default` brings that crate's folder, declared files and dependencies. Putting only its folder and declared files into the inputs would miss what lies behind it.

- [x] The maintainer decides; update `DES-PROJECT-GRAPH`, `DES-INPUTS` and `VER-GRAPH` or `VER-CACHE-KEYS`
- [x] Implement it, with the `bridge` reproduction as a test with the real hasher and `nx affected`, for a source file and a declared file of `api`

## Summary of Changes

The control plane decided the open question, on the basis of what the maintainer agreed for dependency edges ("at least what cargo sees", `REQ-DEPENDENCY-EDGES`, `ADR-ALL-DEP-KINDS`) and of `GOAL-TRUSTED-CACHE`. A crate gets an edge to each crate with a project that it reaches through path dependencies on crates without a project, through any number of them, with the dependency kinds cargo builds for it: its own path dependencies of every kind, and behind them only normal and build dependencies. `^default` then brings that crate's folder, its declared files and its own dependencies. Behind a crate without a report, no edge is guessed. Such an edge is kept where it closes a cycle (through a dev-dependency) and gives way to no other edge. An assumed redirected use in the opposite direction gives way to it and becomes a file input. This is recorded in `DES-PROJECT-GRAPH`, `DES-INPUTS`, `VER-GRAPH` and `VER-CACHE-KEYS`, with user guidance in `workspaces.mara.md` and `caching.mara.md`.

Code: the new `nx-rust/src/graph/reached-projects.ts` (`projectsBehindCratesWithoutProject`, and `knownPackages` moved from `redirected-uses.ts`), with the edges in `edges.ts` and the assumed-use rule in `redirected-uses.ts`.

Checks run:
- Reproduced on `main` first: the new `bridge` test in `declared-files.spec.ts` failed there for a source file and a declared file of `api` (`cross:test` kept its key, and `nx affected` did not select `cross`). It passes with the fix.
- Tests added in `graph.spec.ts` (kinds, chains, no edge behind a `.cargo-checksum.json` crate, a dev-dependency cycle that hashes) and `redirections.spec.ts` (an assumed use gives way). The edge tests fail without the code change.
- Edges and inputs of every fixture and six variants (18 graphs) compared before and after: no edge lost or added, and inputs identical.
- New tests run with the AI agent variables removed: pass.
- `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, before and after merging `origin/main` (#54, then #53): pass.
- `mara schema validate`, `mara project validate` (valid, complete evaluation, no diagnostics) and `zban check`: pass.

Review of pull request #56: a path dependency written through a symbolic link gave no edge (also on `main`), and it hid the edge the new walk adds (four standalone crates `a -> b -> p -> q`, `b` excluded, `alias -> p` named by `b` and by a dev-dependency of `a`). The control plane decided that a path names the crate at the real path of its folder wherever the graph matches a dependency's path to a project or a known crate. The direct edges, the walk (`projectsReachedByPath`, which now returns the direct edges too), the folders of crates without a project, discovery's report requests and the lockfile task's path-package manifests now match by real folder. Recorded in `DES-PROJECT-GRAPH`, `DES-INPUTS`, `DES-METADATA-REPORT`, `DES-LOCKFILE-HASHING`, `VER-GRAPH` and `VER-CACHE-KEYS`. Checks: the review's case with the real hasher and `nx affected`, and a plain project-to-project dependency through a link, fail on 5199940 and pass now. The three changed spec files pass with `CI=true GITHUB_ACTIONS=true` and the agent variables removed. The 18 fixture graphs keep their edges and inputs. After merging `origin/main` (#55): `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check` pass.

Follow-up: nxr-vaywmh, the same hole behind a redirected crate without a project.
