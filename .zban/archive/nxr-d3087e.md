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
