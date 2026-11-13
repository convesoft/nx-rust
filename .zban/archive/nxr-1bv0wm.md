---
title: Create projects, names and edges
status: done
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-7n0nqf
  - nxr-gdt96k
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T12:30:58Z
---

Goal: turn the metadata reports into Nx projects and dependencies.

Implements `REQ-INFERRED-PROJECTS`, `REQ-PROJECT-NAMES`, `REQ-CROSS-WORKSPACE-DEPS`, `REQ-WORKSPACE-PROJECT`, `REQ-DEPENDENCY-EDGES` and `DES-PROJECT-GRAPH` (`nx-rust/docs/workspaces.mara.md`). Checked by `VER-GRAPH`.

- [x] A project per member, rooted at the crate, named after the package
- [x] The name-collision error with both manifest paths
- [x] The workspace project, or the root crate in that role
- [x] Edges for normal, build and dev-dependencies, including across workspaces and through cycles, found through the paths in the `--no-deps` report; no edge for a path dependency without a project
- [x] No external nodes yet: they come with nxr-xq9ava (`DES-PROJECT-GRAPH`)
- [x] Commands address crates by real package name and manifest path

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Each plugin entry's `createNodes` now turns its discovery into projects (`nx-rust/src/graph/projects.ts`): one per member whose manifest Nx handed over, rooted at the crate, and one workspace project per workspace whose root manifest defines no crate and was handed over. The root crate of a workspace has the workspace project's role, as does a standalone crate. Names come from one function, `projectName` (`nx-rust/src/graph/names.ts`), where nxr-xyq7c8 can apply the `name` override, the prefix and the workspace project's `name`. The defaults are the package name, or the workspace folder's path with `/` turned into `-` (`cargo-workspace` at the root). Two projects of one entry with one name fail graph creation, with a message that names every manifest and the remedy for each. `createDependencies` (`nx-rust/src/graph/edges.ts`) creates an edge for every path dependency of each crate and from each workspace project to every member. It looks both ends up by root in the projects Nx passes, so names from `package.json` or `project.json` work and a crate without a project gets no edge. No external nodes. Each `CargoProject` keeps `pkg` (the real package name), `manifest` and `workspace` (the cwd), which are what nxr-t1ht7j's commands use. `name` is only the Nx name.

Settled from accepted items and reproduced evidence:
- Edges are `implicit`. With `static` edges that name the source manifest, Nx keeps the previous graph's edges for unchanged files: removing a `.nxignore` entry left `api` and `rust` without their edges to `testkit` (reproduced by the test "adds an edge when a crate gets a project and no manifest changes", which fails with static edges). Recorded as `EVD-NX-EDGE-CACHE`, with a sentence in `DES-PROJECT-GRAPH`.
- A virtual root manifest that is ignored or excluded gives no workspace project, following `DES-DISCOVERY` ("a manifest matched by `exclude` gets no project").
- The collision message offers `namePrefix` only for a crate in a workspace with more than one member.

Tests: `nx-rust/test/graph.spec.ts` checks the projects and edges of every fixture and that no file is written. It also covers the root workspace project with a root `package.json`, with and without a named `project.json`, an `nx` key or a workspace pattern; two entries that split a workspace, with plugin isolation on and off; each collision `VER-GRAPH` names; and Nx's own error for a collision with a JS project. New fixtures: `mixed-folders` (crate folders with `package.json` or `project.json`, edges between renamed projects) and `nested-folders` (`services-billing`, `apps-Billing.API-rust_v2`). The end-to-end test checks the projects and edges through the installed plugin.

Left to other issues: the override, prefix and project-table `name` (nxr-xyq7c8), targets, so `nx run-many -t test` on the cycle fixture (nxr-t1ht7j), and inputs for path dependencies without a project (`DES-INPUTS`).

Checks run: `pnpm nx run-many -t build lint test` (4 tasks succeeded, 95 unit tests), `pnpm nx format:check --all` (clean), `pnpm nx e2e nx-rust-e2e` with `npm_config_cache_dir` and `pnpm_config_cache_dir` set to an empty folder (6 of 6 passed), `mara schema validate` and `mara project validate` (valid, evaluation complete, no diagnostics), `mara related DES-PROJECT-GRAPH` (shows `Registration`, `inferProjects`, `projectEdges` and `projectName`), and `zban check`.

Follow-ups filed: nxr-p5ybc0 (`[patch]` paths give no edge), nxr-jhdr3x (Nx release skips implicit edges), nxr-kcc5xa (collisions across two entries get Nx's error), nxr-2v14h1 (README status lines).
