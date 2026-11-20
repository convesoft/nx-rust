---
title: Run cargo metadata concurrently for independent Cargo workspaces in ComputationReports
status: done
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:46Z
closed_at: 2026-11-20T13:05:29Z
---

Goal: independent Cargo workspaces in the same repository run `cargo metadata` concurrently during graph creation rather than serializing behind unrelated in-flight requests.

Context: `ComputationReports.find` in `nx-rust/src/graph/computation-reports.ts` waits for every in-flight `cargo metadata` call (`while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)`) before deciding whether to reuse a report (`DES-METADATA-REPORT`, `DES-DISCOVERY`). That prevents unrelated Cargo workspaces in a multi-workspace monorepo from querying `cargo metadata` in parallel.

- [x] Track in-flight requests by their manifest/directory path and await only requests that could belong to the same Cargo workspace (e.g. ancestor or descendant directory relationship)
- [x] Preserve the guarantee that two entries or manifests of the same workspace still invoke `cargo metadata` at most once
- [x] Add unit tests verifying parallel execution for disjoint workspaces and deduplication for manifests in the same workspace

Done when: disjoint workspaces execute `cargo metadata` concurrently while same-workspace deduplication stays intact, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

`ComputationReports` (`nx-rust/src/graph/computation-reports.ts`) no longer waits for every in-flight `cargo metadata` call. Each request records the root manifests that cargo might pick for its workspace (`possibleRoots`). A request waits only for in-flight requests whose sets overlap with its own, then checks the settled reports and starts its call without awaiting anything in between. `DES-METADATA-REPORT` now explains when a request waits.

Cases that still wait: where the manifest has `package.workspace` (or `project.workspace`) or is not valid TOML, the request waits for every in-flight request, and every later request waits for it. The same holds for a manifest without a `[workspace]` table of its own where a `Cargo.toml` in a folder above it has such a key or is not valid TOML, because cargo follows such a pointer in an ancestor manifest too, so a member below an outside member is sent to the root (a review finding, confirmed on Cargo 1.91.0 and 1.100.0). A manifest with its own `[workspace]` table is its only candidate, and the folders above it are not read. A manifest without a `[workspace]` table waits for in-flight requests that share any `Cargo.toml` in its own or an ancestor folder, whether or not that ancestor is a workspace. These run concurrently: manifests with a `[workspace]` table, including a workspace nested in another workspace's folder, which overlaps with the outer one because its candidates are only itself; and manifests in folders with no common ancestor that holds a `Cargo.toml`. The members of a nested workspace still wait for the outer workspace. The manifest path is normalised lexically, as cargo normalises it, before it is read and its ancestors are walked.

Four existing tests compared the cargo call log in exact order where separate workspaces are now reported at the same time: `discovery.spec.ts` (two tests), `init.spec.ts` and `vendored-sources.spec.ts`. They now compare it without order.

Checks run (after merging `main` at 7f9271a):
- `nx-rust/test/computation-reports.spec.ts`, 10 tests. Deduplication runs against a real cargo on fixtures under `$TMPDIR`: a member in a subfolder, a member outside the root's folder through `package.workspace`, a member below that one which cargo sends to the root through the manifest above it (one call, as at 3e87698), a nested separate workspace and a standalone crate. Overlap and waiting run against a held stub runner. A further test covers a path whose link is followed by `..`. Mutations confirm the tests catch regressions: always waiting fails 2 tests, never waiting fails 6, ignoring ancestor pointers fails 2, and skipping normalisation fails 1.
- `pnpm nx format:write`, then `pnpm nx run-many -t build lint test`: passed (71 suites, 2013 tests).
- `pnpm nx e2e nx-rust-e2e`, run after the unit suite: passed (27 tests).
- `pnpm nx format:check --all`: passed.
- `mara schema validate` and `mara project validate`: valid, evaluation complete.
- `zban check`: no errors.

## Decisions made

- Possible workspaces are worked out from the manifest and from the `Cargo.toml` files in its ancestor folders. Only `[workspace]`, `package.workspace` and `project.workspace` are read; the ancestors' `members` and `exclude` are not read, so nothing re-implements cargo's member matching. This is a superset of what cargo decides: at worst a request waits when it did not need to. Recorded in `DES-METADATA-REPORT`.
- Ancestors are walked along the lexically normalised path and along its real path, and roots are compared as real paths, so a symbolic link cannot hide a shared root.
- For a manifest without a `[workspace]` table of its own, an ancestor `Cargo.toml` with `package.workspace` or `project.workspace`, or one that is not valid TOML, makes the request wait for every in-flight request, as when the manifest itself has the key (the reviewer's decision; cargo's member matching is not re-implemented).
- `ComputationReports` takes an optional runner in its constructor (default `requestMetadata`) so tests can count or hold cargo calls without mocking modules. It is a test seam and is not recorded in Mara.
