---
title: Decide what a workspace table's targets entry does on members without that inferred target
status: todo
type: task
parent: nxr-w9qa5f
discovered_from: nxr-xyq7c8
created_at: 2026-11-13T16:22:04Z
---

Goal: the maintainer decides how a `targets.<name>` table in `[workspace.metadata.nx]` applies to a member that has no inferred target of that name, and `DES-PLUGIN-OPTIONS` says so.

Context: the "Targets" paragraph of `DES-PLUGIN-OPTIONS` says that a table under the name of an inferred target overrides it and that under any other name it defines an extra target. nxr-xyq7c8 applies this per project, so a workspace table whose name is an inferred target of only some members (`run` for crates with a binary, `bench` for crates with benches, later the artifact targets) is an extra target on the other members. Where the table names no executor, Nx drops such a target and nothing happens. Where it repeats the inferred executor, which `DES-PLUGIN-OPTIONS` accepts on an inferred target, the other members get a target that names a plugin executor without being inferred, and its task fails when it starts (`DES-TARGETS`, `DES-DIAGNOSTICS`). `nx-rust/test/configuration.spec.ts` shows it for `[workspace.metadata.nx.targets.bench] executor = "@convesoft/nx-rust:cargo"`: `core-lib:bench` fails with the message that says to define a target with a `command`, and `nx run-many -t bench` would then fail for every crate without benches.

Options:

- A. Keep the per-project rule. Document in `DES-PLUGIN-OPTIONS` and the guide that a workspace table should not repeat the executor for a target that only some members have.
- B. A workspace table under the default or renamed name of a target that the plugin can infer applies only to the members that have that inferred target; any other name defines an extra target on every member. A crate's own table keeps the per-project rule.
- C. Fail graph creation for a table that names an executor of the plugin on a target that is not inferred, with a message that names the manifest and the table.

Recommendation: B, which matches what a workspace default is for and leaves no target that cannot run; C could come on top for a crate's own table.

- [ ] Ask the maintainer and record the answer in `DES-PLUGIN-OPTIONS` (and `DES-DIAGNOSTICS` for C)
- [ ] Implement it in `applyTargetTables` (`nx-rust/src/graph/target-tables.ts`), with the case in `VER-CONFIGURATION` and a test

Done when: the decision is in Mara, the implementation follows it, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
