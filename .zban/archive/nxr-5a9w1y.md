---
title: Decide how nx release version treats the bumps that Nx makes across release groups by itself
status: done
type: task
parent: nxr-6q2chq
discovered_from: nxr-1ckcy8
created_at: 2026-11-14T17:58:04Z
closed_at: 2026-11-14T18:49:23Z
---

Needs the maintainer's decision; nothing is to be implemented before it.

The run of the version actions through Nx 24.0.6 (`EVD-NX-24-VERSION-ACTIONS`) showed two ways in which Nx decides bumps across release groups without the version actions' `readDependencies`, which `ADR-RELEASE-DEPENDENTS` makes the source of dependents. The plugin cannot change either; it can only accept them or stop such a run before anything is written. `DES-RELEASE` (paragraph **Dependents**) records both as known limits until this is decided.

1. A fixed release group that gets no bump of its own (conventional commits or version plans give it none) is bumped as a whole through any edge of the project graph to a project of a group that Nx bumped before it. The plugin's edges are `implicit` and a superset of Cargo's dependencies (`DES-PROJECT-GRAPH`), so a dev-dependency, a path dependency without a version, a `[patch]` edge or an edge through a crate without a project bumps the group too; and whether it happens depends on the order of the groups in `nx.json`.
2. A crate in an independent group that depends on a crate of a fixed group is not bumped when Nx bumps the fixed group as a whole, unless its own group bumps it. Its requirement is still rewritten, so its manifest changes while its version stays.

With a specifier on the command line, every project of the run gets it, so neither shows.

- [x] The maintainer chooses, for each of the two: keep it as a known limit, or have the version actions fail such a run before Nx writes anything, with a message that names the crates and what to do
- [x] `DES-RELEASE` is rewritten to the answer, and a follow-up issue is filed if it asks for code

## Summary of Changes

The maintainer answered on 14 November 2026: part 1 "Accept it and say so in the output (Recommended)", part 2 "Stop such a run before anything is written (Recommended)". Implemented in the branch of nxr-1ckcy8, without a separate follow-up issue:

- Part 1: the version actions recognise the bump by the reason `DEPENDENCY_ACROSS_GROUPS_WAS_BUMPED` that Nx passes to `calculateNewVersion` right before `updateProjectVersion`, and print a line per project with the group, each edge into a release group with a crate already versioned in the run, and what the edge is in Cargo. Limit: Nx judges a group bumped by its first project, so with several groups the line can name an edge into a group of which Nx counted another project.
- Part 2: the first `updateProjectDependencies` call of a run, which Nx makes only after every version decision and before any write, checks every requirement rewritten in a normal or build table, and each `[workspace.dependencies]` entry for the members that inherit it, against the crates the run versions, and fails naming each crate and its group. It also stops runs where `updateDependents` keeps Nx from bumping such a crate.
- `DES-RELEASE` (**Dependents**), `VER-RELEASE` (group 2), `EVD-NX-24-VERSION-ACTIONS` (hooks), the release page and `DES-DIAGNOSTICS` record it; tests through real Nx with version plans in `nx-rust/test/release-version.spec.ts`.
- Checks: listed in the summary of nxr-1ckcy8.
