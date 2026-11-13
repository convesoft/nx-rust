---
title: Report target defaults that change Rust targets
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-pana9e
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T16:29:57Z
---

Goal: a repository learns when one of its `targetDefaults` entries adds `^build` to Rust targets or replaces their inferred inputs.

Implements the draft `REQ-TARGET-DEFAULT-GUARD` (`nx-rust/docs/targets.mara.md`), which mitigates `RISK-TARGET-DEFAULTS`. The requirement has to be accepted first, using the result of the spike that blocks this issue.

- [x] Accept `REQ-TARGET-DEFAULT-GUARD` with a design and verification, after the user agrees
- [x] Implement the report and name the entry, the target and the fix
- [x] Report a target default that replaces a crate target's `dependsOn`, which drops the dependency on the workspace's `lockfile` task and with it the lockfile digest from the key (`DES-LOCKFILE-HASHING`, "Excluded dependencies")
- [x] Document narrowing a target default in `targets.mara.md`
- [x] Consider in the requirement an entry that sets `cache: true` on an inferred Rust target, keyed by the target's name or by its executor, which Nx lays over the plugin's `cache: false` (`EVD-NX-TARGET-DEFAULTS`): until nxr-fy4t4k declares the inputs, such a target would be cached with Nx's default inputs (`GOAL-TRUSTED-CACHE`; the interim rule is in the status note of `nx-rust/docs/targets.mara.md`), and on `fmt`, `bench`, `run`, `audit`, `deny` and `update` it contradicts `DES-TARGETS` for good
- [x] Print the report from `init` too, as nxr-dp5q0f planned, next to its report of tools (`nx-rust/src/generators/init/report.ts`), with `DES-GENERATORS` and `VER-SETUP` extended after the user agrees

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The maintainer answered the issue's three questions before work started: widen the requirement as proposed, split severity by harm, and have `init` warn only, never editing `targetDefaults`. The control plane settled two consequences: losing the `lockfile` dependency is an error, and caching turned on for any target the plugin leaves uncached is an error.

- Mara:
  - `REQ-TARGET-DEFAULT-GUARD` is accepted with the maintainer's wording.
  - New `DES-TARGET-DEFAULT-GUARD` (`targets.mara.md`): `createDependencies` compares each inferred target with the target Nx merged. It uses Nx's own `readTargetDefaultsForTarget` to find the key and elements that apply, so `filter` works as in Nx, and it skips elements that Nx drops for naming another executor or a `command`. It reports only where that entry sets the field. Errors are caching turned on where the plugin's `cache` is not `true`, and a lost `inputs`, `outputs` or `dependsOn` entry. The warning is an added dependency on other projects' tasks.
  - New `VER-TARGET-DEFAULT-GUARD` (`verification.mara.md`).
  - Three rows in `DES-DIAGNOSTICS`: the error, the warning, and an Nx without the resolver.
  - `DES-GENERATORS` step 1 and its report, and `VER-SETUP`'s `init` cases.
  - Cross-references in `DES-LOCKFILE-HASHING` and `RISK-TARGET-DEFAULTS`.
  - New user section "Target defaults that reach Rust targets" in `targets.mara.md`, and a rewritten status note.
- Code:
  - `nx-rust/src/graph/target-defaults.ts`, hooked into `createDependencies` (`nx-rust/src/index.ts`).
  - Since the merge of #27, `init` reaches the report through `createDependencies`; this branch adds no code of its own to `init`.
  - The cache comparison uses the inferred `cache`, which `target()` sets from `cachedTargets`. That is the set the executor's check from #28 reads, and that check stays as the second line.
  - #28's tests of that check in `nx-rust/test/executors.spec.ts` set `cache: true` through a `project.json` now. Through `targetDefaults`, graph creation fails first.
- Lockfile step: the comparison is with whatever `dependsOn` the plugin infers. The `lockfile` dependency does not exist yet, so a unit test checks that case with a stand-in value. nxr-xq9ava has a step to add the real case.
- Checks, after merging `origin/main` at e14459a:
  - `pnpm nx run-many -t build lint test`: 16 suites, 422 tests passed.
  - `pnpm nx format:check --all`: passed.
  - `pnpm nx e2e nx-rust-e2e`: 17 of 17 passed.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, no diagnostics, every policy check passed.
  - `zban check`: no problems.
  - `nx-rust/test/target-defaults.spec.ts` covers `VER-TARGET-DEFAULT-GUARD` and the `VER-SETUP` cases. It uses real Nx graph creation and a real `nx g`, plus unit tests on stand-in inferred values for `outputs` and `dependsOn`.
- Not covered here:
  - The warning in a task's output with the daemon on: nxr-rxzgbq, since the executor does not print graph-time warnings yet.
  - The real `inputs`/`outputs` cases: a step in nxr-fy4t4k.
  - The real `lockfile` case: a step in nxr-xq9ava.

Review of pull request #32 (four findings, fixed in one round):

- The guard now learns which layer changed a value from Nx's own code. `createDependencies` receives no source maps, so where a target differs from what the plugin inferred, it does the following:
  - It runs Nx's default plugins (`nx/src/plugins/package-json` and `project-json`) on the `package.json` and `project.json` in the project's folder that Nx sees.
  - It hands that layer, its own `createNodes` result and a source map naming its entry to Nx's `createTargetDefaultsResults`, which returns exactly the `nx.json#targetDefaults.<key>[<index>]` elements Nx laid over the target.
  - A field that the folder's file sets without `"..."` is that file's and is not reported. Added `dependsOn` entries are resolved with Nx's `expandDependencyConfigSyntaxSugar` and `normalizeDependencyConfigProjects`.
  - `readTargetDefaultsForTarget` is no longer used.
- The four findings:
  - The executor supplied by a `project.json`: the `build` entry is reported for that crate only.
  - A harmless entry beside a `project.json` or `package.json` that replaces inputs: not reported. With `"..."` in that file, the entry is still reported.
  - `projects: ["api*"]` on `api`: no warning; `mod*`: a warning.
  - `init` cases for `fmt`, `build`, the executor key and `update` inputs, and an Nx copy without `createTargetDefaultsResults` through graph creation.
- Combinations, each with a test:
  - Executor and name keys both matching: only the executor's is reported.
  - `targetNames` renaming `lint` to `clippy`: `clippy` is reported, `lint` is not.
  - `"..."` plus `^build`: a warning.
  - A `!tag:lang:rust` filter with tags from `[workspace.metadata.nx]`: nothing is reported.
  - A `targets.update` table (#31) that keeps the inputs with `"..."`: an entry that replaces them is reported, one that keeps them is not.
- Mara: `DES-TARGET-DEFAULT-GUARD` ("What counts", "Which layer"), its row in `DES-DIAGNOSTICS` for missing internal parts, and `VER-TARGET-DEFAULT-GUARD` with the new cases.
- Filed nxr-8rcaxm at the maintainer's request (`nx add` writes empty entries for the plugin's executors), with a step in nxr-xq9ava. This pull request leaves `init` reporting and not editing.
- Checks after merging `origin/main` at 65d5338 (#31):
  - `pnpm nx run-many -t build lint test`: 17 suites, 510 tests passed.
  - `pnpm nx format:check --all`: passed.
  - `pnpm nx e2e nx-rust-e2e`: 19 of 19 passed.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, no diagnostics, every policy check passed.
  - `zban check`: no problems.
