---
title: Compare the artifact directories of workspaces that separate plugin entries receive
status: done
type: bug
priority: low
discovered_from: nxr-ew8kb3
created_at: 2026-11-14T20:22:50Z
closed_at: 2026-11-14T21:29:07Z
---

Goal: two Cargo workspaces that share one artifact directory are recognised as sharing it also where different entries of the plugin in `nx.json` receive them, so that `doc` stays uncached for both and crates whose files share a name lose the caching of `build` (and `test`) as `DES-OUTPUTS` says (`GOAL-TRUSTED-CACHE`).

Context: graph creation compares artifact directories within one entry's discovery only: `artifactDirectorySharers` and `sharedArtifactNames` (`nx-rust/src/graph/caching.ts`, `nx-rust/src/graph/artifact-names.ts`) see the workspaces of the entry whose `createNodes` runs. Read from the code, not yet run: two entries, for example one per folder with `include`, over workspaces with one `build.target-dir` would therefore leave `doc` cached for both, and leave cached the `build` of crates whose binaries share a file name across them. `RISK-ARTIFACT-DIR-WRITERS` ("Files of one name that graph creation does not see") and the last sentence of `DES-OUTPUTS` "Files of one name" record the limit.

- [x] Reproduce with two plugin entries whose workspaces share one artifact directory, for `doc` and for two binaries of one name
- [x] Decide where the comparison can see every entry's workspaces (the reports of one graph computation are shared through `computationReports`) and update `DES-OUTPUTS` and the risk
- [x] Implement and test it, with plugin isolation on and off

## Summary of Changes

Closed in the branch of nxr-ew8kb3, as its review asked; the review of nxr-ew8kb3 reproduced it (two entries, `include` of `rust/**` and `tools/**`, one `build.target-dir`: both `build` targets and both `doc` targets cached, and a held run stored the other crate's executable under `alpha:build`).

- With two or more entries of the plugin, each entry also reads the workspaces that the others receive and it does not (`otherEntriesWorkspaces` in `nx-rust/src/graph/entries.ts`): it applies every entry's `include` and `exclude` to the `Cargo.toml` files of Nx's workspace context, as `checkEntries` already does, leaves out what its own workspaces claim, and reads the rest with discovery's own claim logic (`discoverReportedWorkspaces` in `nx-rust/src/graph/discovery.ts`), reports only. The comparison of artifact directories (`doc` sharing, files of one name, shared record names) runs over all of them, so every entry reaches the same verdict whatever the order of the entries. A failing report of another entry's workspace is left to that entry. The shared-name warning is printed by the entry that holds the first crate's workspace, so once per graph creation.
- Rejected: a check when the task starts (option b), because (a) works with Nx 24.0.6 under plugin isolation on and off, reusing the entry context that `checkEntries` relies on (`EVD-NX-24-ENTRY-CONTEXT`), and keeps such builds running uncached rather than failing.
- Cost, measured on `shared-executables` (two workspaces): no extra cargo call without plugin isolation (the entries share their reports); one extra `cargo metadata --no-deps` per workspace of the other entry in each isolated worker; no difference in time beyond the spread of runs; nothing extra with one entry.
- Knowledge: `DES-OUTPUTS` (the `doc` sharing paragraph and "Files of one name"), `DES-DIAGNOSTICS`, `VER-CARGO-UNCHANGED`, `RISK-ARTIFACT-DIR-WRITERS`, `EVD-CARGO-ARTIFACT-WRITERS`.
- Tests: `nx-rust/test/shared-executables.spec.ts`, graph with isolation on and off and a run test; they fail with the other entries' workspaces left out.
- Checks: those of nxr-ew8kb3 on the same tree.
