---
title: Declare the inputs of crates that [patch], [replace] or paths redirect to
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-p5ybc0
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:02:59Z
---

Goal: a crate that a workspace's `[patch]`, `[replace]` or `paths` may put in place of a registry or git dependency reaches the cache keys of every member that may use it, also where it has no project or its edge is left out.

Pull request #24 (nxr-p5ybc0) adds the edges to redirected crates (`src/cargo/redirections.ts`, `redirectedUses` in `src/graph/edges.ts`) and a step for these inputs to nxr-fy4t4k. nxr-fy4t4k closed before #24 merged, so the step lives here. When #24 merges, drop the step it adds to the archived nxr-fy4t4k in favour of this issue. Implements the "Redirected crates" row of `DES-INPUTS` and the redirection sentence of `REQ-INPUT-FILES` as #24 changes them (`ADR-REDIRECTION-EDGES`, `DES-PROJECT-GRAPH`). Checked by the `VER-CACHE-KEYS` rows that #24 adds for redirected crates.

nxr-fy4t4k built the place: `findPathDependencies` in `nx-rust/src/graph/path-dependencies.ts` gives each crate the folders of the path dependencies without a project that it reaches, with the warning for those that Nx cannot see; `namedInputs` in `nx-rust/src/graph/inputs.ts` puts them into the crate's named input `default`.

- [ ] A crate that a workspace's `[patch]` or `[replace]` redirects to and that has no project is handled like a path dependency without one, on every member that `redirectedUses` lists for its folder when it is given the folders of the workspace's redirections, the warning included; the folder of a `paths` entry without a project at it likewise
- [ ] A member whose use `redirectedUses` returns with `edge: false` gets a fileset for that crate's folder on its targets
- [ ] The `VER-CACHE-KEYS` rows for redirected crates, in `nx-rust/test/cache-keys.spec.ts`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
