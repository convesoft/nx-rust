---
title: Point imports at the split modules, drop the re-exports and break the import cycles
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-8jv932
  - nxr-rxetx7
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:15Z
---

Goal: after the module split of nxr-w6117m, every file imports from the module that owns a name, and `nx-rust/src/` has no import cycle that runs at load time. No behaviour changes.

Context: finding 6 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: behavior, on top of the seam issues it waits for, which change the same files. The split kept the old paths as entries, because the tests and eight neighbouring executors could not be edited then:

- `nx-rust/src/executors/task.ts` (about lines 64-71) re-exports `checksAfterCargo`, `GroupInvocation`, `groupInvocations`, `PluginExecutor`, `projectWarnings` and `TaskError`; `batch.ts`, `group-run.ts`, `stage.ts` and four specs import through it;
- `nx-rust/src/graph/target-defaults.ts` (about line 47) re-exports `describeTargetDefaultChanges`, `loadTargetDefaultsInternals` and `targetDefaultsGuide` for two specs;
- `nx-rust/src/release/publish.ts` (about line 72) re-exports four names that nothing imports any more;
- cycles at run time: `group-run.ts` and `task.ts` import each other, and three more go through `task.ts` to `staged-run.ts`, `napi-build.ts` or `wasm-build.ts` and back to `group-run.ts`; in `graph/`, `targets.ts` and `caching.ts` import each other, also through `artifact-names.ts` and through `path-dependencies.ts`, `settings.ts` and `options.ts`;
- the doc comment on `findTargetDefaultChanges` (`target-defaults.ts`, about line 77) says that a target no `targetDefaults` key reaches is never reported, which `DES-TARGET-DEFAULT-GUARD` and the code below it contradict.

- [ ] Redirect the imports in the source and the specs, and remove the three re-export lines
- [ ] Break the cycles by moving leaf names to where nothing imports back: for example `hasLibrary` beside `reportsLibrary` in `command.ts`, and the target constants and predicates of `graph/targets.ts` (`targetCargoMetadataKey`, the executor names, `testReplacesExecutables`) into a module of their own
- [ ] Correct the doc comment
- [ ] Keep the `// @mara implements` markers on their declarations and compare the code links before and after with `mara related`

Done when: a check for cycles finds none that runs at load time, the Mara links are the same, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
