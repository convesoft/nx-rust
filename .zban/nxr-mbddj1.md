---
title: Decide what the executors do with options and targets outside the option reference
status: todo
type: task
parent: nxr-w9qa5f
related:
  - nxr-wea5vt
  - nxr-xyq7c8
discovered_from: nxr-kmdpgj
created_at: 2026-11-13T15:45:33Z
---

Goal: `DES-PLUGIN-OPTIONS`, `DES-UNKNOWN-OPTIONS` and `DES-DIAGNOSTICS` say what the plugin's executors do in two cases that they leave open, after the maintainer has chosen.

**1. A declared option on a target that does not take it.** One schema serves every target of the cargo executor (nxr-kmdpgj), so it declares options that the option reference of `DES-PLUGIN-OPTIONS` gives only some targets: `targetTriple` on `test`, which runs on the host triple only in v1, `allTargets` on `build`, `noDeps` on `check`, `features` on `fmt`, `audit`, `deny` or `update`. `DES-UNKNOWN-OPTIONS` treats only undeclared options, so such an option gets no line there. Since nxr-kmdpgj the command leaves it out without a word (`cargoArguments` in `nx-rust/src/executors/command.ts`). Options:

- (a) Leave it out silently, as now.
- (b) Leave it out with a warning line like that of `DES-UNKNOWN-OPTIONS`, which says that the target does not take the option.
- (c) Fail the task.

Recommendation: (b). It keeps `REQ-UNKNOWN-OPTIONS`'s promise that the task runs as it would without the option, and a `targetDefaults` entry such as `test: { options: { targetTriple: … } }` does not then do nothing without a word. The lines would come with nxr-wea5vt's code.

**2. A target that names one of the plugin's executors but is not inferred**, such as an extra target in a `project.json` with `"executor": "@convesoft/nx-rust:cargo"`, or, once nxr-xyq7c8 reads them, in a metadata table. It carries no `metadata.cargo.target`, so the executor cannot tell which command to run. Since nxr-kmdpgj the task fails before cargo runs, with a message that says to define a target with a `command` instead (`taskInvocation` in `nx-rust/src/executors/task.ts`). `DES-PLUGIN-OPTIONS` says that another command runs as an extra target under another name, but not what the plugin's executors do on such a target. Options:

- (a) Keep the task's failure and list it in `DES-DIAGNOSTICS`; for a metadata table, fail graph creation instead.
- (b) Give the executors an option that names the command for such a target.

Recommendation: (a). An extra target with a `command` already runs any cargo command, and (b) adds a second way.

- [ ] The maintainer's answers recorded in the items above
- [ ] The executors and `nx-rust/test/executors.spec.ts` changed to match, together with nxr-wea5vt where that has not landed yet
