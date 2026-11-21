---
title: "Finish the Nx bridge: shared contract types, module paths in one place, one inspector bootstrap"
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:45:55Z
---

Goal: everything that knows a private part of Nx knows it through `nx-rust/src/compatibility/nx-bridge.ts` (`RISK-UPSTREAM-CHANGES`): its types, its module paths and how its objects are made.

Context: finding 5 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. nxr-gtxq18 made the bridge; these parts still sit outside it or differ inside it:

- contract types repeated: `nx-rust/src/graph/target-defaults-layers.ts` (about lines 22-50) repeats `NxRootMapProject`, `NxSourceMaps`, `NxNormalisedDependency` and `NxDependencyGraph`; `nx-rust/src/generators/init/graph-check.ts` (about 214-243) repeats `NxLoadedPlugin` and the signatures of `NxDevkitInternals`, `NxGetPlugins` and `NxRetrieveWorkspaceFiles`; `nx-rust/src/graph/nx-internals.ts` (about 11-51) repeats `NxDevkitInternals`;
- private module paths written out as `"nx/src/…"` strings in `nx-internals.ts` (about lines 53 and 182) and `graph-check.ts` (310, 336, 342, 377), where the bridge's error already names the module;
- in the bridge, `ProcessDependenciesError` and `HashPlanInspector` are checked as functions while `LoadedNxPlugin` is checked as a constructor, and `loadNxDependency` (about line 158) resolves `dotenv` again on every call where `loadNxYargsParser` caches;
- `nx-rust/src/executors/affected-inputs.ts` (about lines 62-95) and `nx-rust/src/executors/nx-task-files.ts` (73-161) each load, make, initialize and check a `HashPlanInspector`; `nx-rust/test/nx-task-files.spec.ts` (about 109-111) loads it a second time.

- [ ] Reuse the bridge's types in the three files, and take module names for messages from the bridge's error
- [ ] Check constructors as constructors, and cache `loadNxDependency`
- [ ] One helper that makes and checks an initialized inspector, used by both executors' files; this is about one place for the code, not about sharing one inspector between checks, which nxr-ffjvc9 measured and did not keep
- [ ] Keep every tripwire test passing, and add one where a part gets its first check

Done when: `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
