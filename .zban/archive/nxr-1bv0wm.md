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

Each plugin entry's `createNodes` now turns its discovery into projects (`nx-rust/src/graph/projects.ts`). Each member whose manifest Nx handed over becomes a project rooted at the crate. Each workspace whose root manifest defines no crate and was handed over gets a workspace project. The root crate of a workspace has the workspace project's role, as does a standalone crate. Names come from one function, `projectName` (`nx-rust/src/graph/names.ts`), where nxr-xyq7c8 can apply the `name` override, the prefix and the workspace project's `name`. The defaults are the package name, or the workspace folder's path with `/` turned into `-` (`cargo-workspace` at the root). Each project carries in its metadata, under `cargo`, the plugin's name for it, its manifest, its workspace's root manifest and, for a crate, the package name. Since the merge of #16, the naming rule is the one `DES-PLUGIN-OPTIONS` and `DES-PROJECT-GRAPH` give (an explicit `name` as it is, otherwise the prefix put in front of the package name); nxr-xyq7c8 implements the settings and has a step for the remedies of the collision message.

Name collisions (`nx-rust/src/graph/collisions.ts`): every check runs in `createDependencies`, within an entry and across entries, against the merged projects Nx passes, so a name from `package.json` or `project.json` counts as the project's name. Another entry's projects are recognised by `metadata.cargo` (key confirmed by the maintainer). Two projects of the plugin with one name always fail graph creation, with Nx's "defined in multiple locations" error first, naming every folder. The plugin's error with the manifests and remedies is promised for two projects that collide under the plugin's names, in one entry or across two entries that receive different manifests. Elsewhere it is best effort, as the control plane decided after the third review under the maintainer's instruction. `REQ-PROJECT-NAMES`, `DES-PROJECT-GRAPH`, `VER-GRAPH` and the guidance say so.

Edges (`nx-rust/src/graph/edges.ts`): every path dependency of each crate gives an edge, and each workspace project depends on every member. Both ends are looked up by root in the projects Nx passes, so names from `package.json` or `project.json` work and a crate without a project gets no edge. Edges are `implicit`, as the maintainer decided on 2026-11-13, because Nx puts back cached file dependencies for unchanged files. `EVD-NX-EDGE-CACHE`, corrected after the review, records the source reading, the reviewer's eight cases with the daemon on and off, the alternatives and the readers of the edge type, and `DES-PROJECT-GRAPH` names the accepted costs. No external nodes. Each `CargoProject` keeps `pkg` (the real package name), `manifest` and `workspace` (the cwd) for nxr-t1ht7j's commands; `name` is only the Nx name.

Also settled: an excluded or ignored virtual root manifest gives no workspace project (`DES-DISCOVERY`).

Known gap, by the maintainer's decision: a registry dependency that `[patch]` redirects to a crate of the repository gives no edge (nxr-p5ybc0, high, blocks the 0.1 milestone). The status note of `workspaces.mara.md` names it.

Known collision corners, all failing graph creation with Nx's error and left as best effort: entries that receive the same manifests repeat the plugin's message, a root crate among three holders makes it name only two manifests, and a common name from `project.json` files gives Nx's error alone.

Tests: `nx-rust/test/graph.spec.ts` checks the projects and edges of every fixture and that no file is written. It also checks the metadata, the root workspace project in five root configurations and two entries splitting a workspace. For collisions, with isolation on and off, it checks the cases `VER-GRAPH` names: within one entry and across two, renames through `project.json` added and removed in one entry and in two, a third project that is not the plugin's, two crates renamed to one common name, three crates in three entries, and a collision in one entry together with one across entries. It also checks Nx's own error for a JS project, and an edge that appears when a crate gets a project without a manifest changing. Two mutations (ignoring effective names; dropping the check for other holders) were caught. New fixtures: `mixed-folders` and `nested-folders`. The end-to-end test checks projects and edges through the installed plugin.

Left to other issues: the override, prefix and project-table `name` (nxr-xyq7c8), targets, so `nx run-many -t test` on the cycle fixture (nxr-t1ht7j), and inputs for path dependencies without a project (`DES-INPUTS`).

Checks run on the final commit: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` and `zban check`. The pull request description has their results.

Follow-ups filed: nxr-p5ybc0 (`[patch]` paths give no edge), nxr-jhdr3x (Nx release skips implicit edges), nxr-2v14h1 (README status lines).
