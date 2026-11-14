---
title: Reach a crate with a project behind a redirected crate without a project
status: done
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-08gwaj
created_at: 2026-11-13T21:54:25Z
closed_at: 2026-11-14T07:59:59Z
---

Goal: a member that uses a crate without a project through `[patch]`, `[replace]` or `paths` hashes the inputs of the crates with a project behind that crate, and `nx affected` selects it when they change (`GOAL-TRUSTED-CACHE`, `REQ-INPUT-FILES`, `REQ-DEPENDENCY-EDGES`).

Found while fixing nxr-08gwaj. That issue gives a crate an edge to each crate with a project that it reaches through path dependencies on crates without a project (`DES-PROJECT-GRAPH`, "Edges"). The same hole remains where the first crate without a project is reached through a redirection rather than a path dependency: `findCrateFolders` in `nx-rust/src/graph/path-dependencies.ts` puts the redirected crate's folder and the crates without a project behind it into the member's inputs, but stops at a crate with a project, and neither `projectEdges` nor `redirectedUses` gives the member an edge to it.

Reproduction, on the branch of nxr-08gwaj: in `patched-workspaces`, make `third_party/fork` (excluded, redirected by `rust`'s `[patch.crates-io]`, used by `api` through `fork = "0.1"`) depend on `plain = { path = "../../rust/crates/plain" }` in place of `model = "0.1"`. `api` gets edges to `model` and `types` only, and its `default` input holds `third_party/fork/**/*` but nothing of `plain`, so a change to `plain` leaves `api`'s keys the same.

Not decided: whether the walk of `projectsBehindCratesWithoutProject` (`nx-rust/src/graph/reached-projects.ts`) should also start from the redirected crates without a project that a member uses, for direct, possible and assumed uses alike, and how a possible or assumed use of such a crate weighs against an edge in the opposite direction.

- [x] Decide, and update `DES-PROJECT-GRAPH`, `DES-INPUTS` and `VER-GRAPH` or `VER-CACHE-KEYS`
- [x] Implement it, with the reproduction above as a test with the real hasher and `nx affected`

## Summary of Changes

Decision: the control plane settled the "Not decided" paragraph under `GOAL-TRUSTED-CACHE`. The walk also starts from the redirected crates without a project that a member uses through `[patch]`, `[replace]` or `paths`, for direct, possible and assumed uses alike. What it reaches inherits the kind of that use, and it weighs against an opposite edge exactly as `DES-PROJECT-GRAPH` already says for a use of that kind of a redirected crate with a project, with no new conflict rule. More invalidation than necessary is acceptable.

Code: `projectsBehindDependency` in `nx-rust/src/graph/reached-projects.ts` walks a redirected crate's normal and build path dependencies, never its dev-dependencies, through crates without a project, by real folder. `workspaceUses` in `redirected-uses.ts` gives the member a use of each crate it reaches. Where several uses lead to one crate, or the crate is redirected itself, the strongest kind counts. The existing cycle, mutual-possible and assumed rules then apply unchanged. A left-out use becomes a file input through `leftOutEdges`, as before. `edges.ts` and `path-dependencies.ts` needed only comments.

`paths`: the walk needs the redirected crate's report, and discovery requested one only for `[patch]` and `[replace]`. It now also requests one for a crate whose `Cargo.toml` lies in a `paths` folder itself (`DES-METADATA-REPORT`). That costs one cargo call per such crate without a project, and a failed report warns as for `[patch]`. Crates deeper below a `paths` folder still get no report, so the crates with a project behind them are still missed. That gap is reproduced and filed as nxr-8sf4xw.

Mara: `DES-PROJECT-GRAPH` (Redirected crates, Cycles), `DES-METADATA-REPORT`, `DES-INPUTS` (Dependency sources, Redirected crates), `VER-GRAPH`, `VER-CACHE-KEYS`, and the user guidance in `workspaces.mara.md` and `caching.mara.md`.

Tests, in `redirections.spec.ts`, each with the real hasher and `nx show projects --affected` (through `runNx`): the issue's reproduction, then the same through `[replace]`, through `paths`, through a chain of two crates without a project, and through a path dependency written through a symbolic link. In each, a change to `plain` changes the keys of `api` (direct use), `harness` (possible) and `lone` (assumed, through a directory-source crate without a report), leaves `types:test` unchanged, and selects every member that may use `fork`. A sixth test covers the cycle rule: where `plain` depends on `harness` and `lone`, their inherited uses are left out and become inputs, while `api` keeps its edge. All six fail on the sources before the change.

Graph identity: the projects, edges and every target's inputs of all 15 fixtures and 5 redirection variants were dumped before and after the change, on `a9d583b` and again on `d633767`. They are identical. The only differences are one more cargo call for a `paths` crate without a project, and a temporary path inside `name-collision`'s expected error.

Checks run: `pnpm nx run-many -t build lint test` (946 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `redirections.spec.ts` with the agent variables removed and `CI=true GITHUB_ACTIONS=true` (38 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no warnings), and `zban check`. CI on the pull request runs the same suite on Linux.

### Review follow-up

The review found a wrong cache hit. Where the conflict rules leave out a use of a crate with a project, the member got that crate's folder and declared files but nothing of what the crate depends on. The edge would have brought those through `^default`. The control plane decided that a left-out use brings, as file inputs on the member's targets, the folder, workspace manifest and declared files of the crate and of every crate it reaches through normal and build dependencies, to any depth: path dependencies by real folder and direct redirections of the member's workspace. The walk passes no dev-dependency and ends at the member, which it never includes. This covers every left-out use, so `main` is fixed too. There, a possible use of a patched crate with a project, dropped because the two crates may only possibly use each other, kept the member's keys after a change to a crate behind it.

Code: `broughtFolders` in `redirected-uses.ts` fills `RedirectedUse.brings`. `findCrateFolders` in `path-dependencies.ts` locates those crates like the others without an edge, and `caching.ts` warns for one that Nx cannot see. Mara: `DES-PROJECT-GRAPH` (Redirected crates), `DES-INPUTS` (Redirected crates, Declared files), `VER-GRAPH` and `VER-CACHE-KEYS`, with the guidance in `workspaces.mara.md`.

Tests in `redirections.spec.ts`, each with the real hasher and `nx show projects --affected`, all changing `c`, on which `b` depends by path:
- The reviewer's case: `a` and `b` may only possibly use each other, `b` behind the patched `x`.
- The assumed variant: `a`'s use of `b` behind `x` yields to `b`'s dev-dependency on `a`.
- The same shape with a patched `b` that has a project of its own.

In each, `a`'s keys change, `d:test` is the control and stays the same, and `a` is affected. All three fail on the reviewed head and on `main`. The reviewer's reproduction now changes all five cached keys of `a` and lists `a` as affected.

Lockfile digest: `a`'s digest from the reviewer's `Cargo.lock` changes when the locked `other` changes, and stays the same when an unrelated package is added, so the registry crates behind a left-out use are covered. Graph comparison on `2338187`, before and after: all 15 fixtures and 5 redirection variants are identical. Two variants with left-out uses gain inputs only: the `types` folder and `shared/Cargo.toml`, which the left-out crate reaches through a direct redirection.

Filed: nxr-00e2fw, because the fallback does not carry the `envInputs` and `runtimeInputs` of those crates.
