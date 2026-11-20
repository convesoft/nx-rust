---
title: Run cargo metadata concurrently for independent Cargo workspaces in ComputationReports
status: todo
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:46Z
---

Goal: independent Cargo workspaces in the same repository run `cargo metadata` concurrently during graph creation rather than serializing behind unrelated in-flight requests.

Context: `ComputationReports.find` in `nx-rust/src/graph/computation-reports.ts` waits for every in-flight `cargo metadata` call (`while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)`) before deciding whether to reuse a report (`DES-METADATA-REPORT`, `DES-DISCOVERY`). That prevents unrelated Cargo workspaces in a multi-workspace monorepo from querying `cargo metadata` in parallel.

- [ ] Track in-flight requests by their manifest/directory path and await only requests that could belong to the same Cargo workspace (e.g. ancestor or descendant directory relationship)
- [ ] Preserve the guarantee that two entries or manifests of the same workspace still invoke `cargo metadata` at most once
- [ ] Add unit tests verifying parallel execution for disjoint workspaces and deduplication for manifests in the same workspace

Done when: disjoint workspaces execute `cargo metadata` concurrently while same-workspace deduplication stays intact, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
