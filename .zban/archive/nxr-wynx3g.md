---
title: Decide what the cargo executor does with options that target defaults add
status: done
type: task
parent: nxr-w9qa5f
related:
  - nxr-d3087e
discovered_from: nxr-pana9e
created_at: 2026-11-13T08:35:28Z
closed_at: 2026-11-13T11:03:49Z
---

Goal: the plugin's cargo executor treats an option it does not know, such as one that a `targetDefaults` entry written for a JS executor adds to an inferred Rust target, in a way that is decided and recorded in Mara.

Context: `EVD-NX-TARGET-DEFAULTS` (`nx-rust/docs/decisions.mara.md`) shows that a target default's `options` reach the executor of an inferred target (`RISK-TARGET-DEFAULTS`). With an open schema the option arrives silently and is part of the task hash; with `additionalProperties: false` the batched task fails with an error that names neither the option nor the entry.

- [x] Agree with the maintainer whether the executor rejects, ignores or reports unknown options, possibly through `REQ-TARGET-DEFAULT-GUARD`, and record the choice in Mara
- [x] The recorded rule makes the warning for an unknown option name the option, the task and where the option came from (`NEED-CLEAR-FAILURES`); the maintainer chose to warn, so no unknown option fails a task

Done when: the decision is accepted in Mara and `mara project validate` reports `valid: true`.

## Summary of Changes

- The maintainer answered the decision brief on 13 November 2026. Recorded as accepted items:
  - `REQ-UNKNOWN-OPTIONS` (`configuration.mara.md`): an option the executor does not know, from a target default, `project.json`, `package.json` or the command line, is ignored with one warning line per option in the task's output. It satisfies `NEED-CLEAR-FAILURES` and mitigates `RISK-TARGET-DEFAULTS`.
  - `REQ-UNKNOWN-METADATA-OPTIONS`: an unknown key under a target's `options` or under one of its configurations in a metadata table, the `[workspace.metadata.nx.project]` table included, fails graph creation. Configurations were settled on 13 November 2026 as following from answer 5, on the same ground: the plugin owns that source and knows its option list when the graph is built.
  - `DES-UNKNOWN-OPTIONS`:
    - Open schemas with typed options.
    - The warning names the source that Nx actually used: the command line, then the task's configuration, then `options`, each as the crate folder's `project.json`, its `package.json` (when Nx read it) and the one `targetDefaults` key that Nx selected set it. It names a source only when that source gives the received value; otherwise it points to `nx show target <project>:<target> --json`.
    - For a target default it suggests a `filter` or an empty entry keyed by the target's executor.
    - On `run`, the arguments after `--` go to the binary, as the accepted `DES-TARGET-COMMANDS` says. The plugin's `preTasksExecution` hook tells the executor whether the command had `--`.
    - A wrongly typed declared option fails every task that Nx hands to the batch implementation, and only the affected tasks without a batch. This is a known limitation.
  - `ADR-UNKNOWN-OPTIONS` (`decisions.mara.md`), with the rejected alternatives.
  - `EVD-NX-OPTION-VALIDATION`: the experiments and source reading on Nx 24.0.6 behind the decision.
  - `VER-UNKNOWN-OPTIONS` (`verification.mara.md`), which verifies both requirements.
- `RISK-TARGET-DEFAULTS` now names the mitigation. `REQ-TARGET-DEFAULT-GUARD` and `DES-PLUGIN-OPTIONS` are unchanged.
- `DES-DIAGNOSTICS` (`setup.mara.md`, accepted in #9) has two new rows: the task-start warning and the graph-time error. `VER-SETUP` lists the graph-time error among the cases for which `init` fails and leaves `nx.json` unchanged.
- After the review of 13 November 2026, a source attribution that could name a source that did not supply the option was replaced by the one above. `VER-UNKNOWN-OPTIONS` gained these cases:
  - three in which a `project.json` supplies the option;
  - the configuration over `options`;
  - `package.json`;
  - one group with different values;
  - `run`;
  - the workspace table's configurations and its `project` table.
- The evidence item gained the following:
  - how Nx treats `--`;
  - the `preTasksExecution` mechanism;
  - what `ProjectConfiguration` covers;
  - `nx show target`'s `sourceMap`;
  - the single-task failure for a wrongly typed value.
- User guidance: a new section "Options that cargo does not use" in `targets.mara.md`, and a paragraph on unknown keys under `options` in `configuration.mara.md`.
- The second task item was reworded for the "warn" outcome.
- Follow-ups:
  - nxr-wea5vt: implement the warning.
  - nxr-95kg91: implement the graph-time check.
  - nxr-26t4qt: Nx hashes `nx.json`, and the options and configurations of every target of a project, into each of its tasks.
  - nxr-vmsm6h: Nx drops the flags before `--`, so `run` cannot take its `--bin` option and the binary's arguments in one command.
- Checks, on the final commit of each round:
  - `pnpm nx format:write`.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, 0 errors, 0 warnings.
  - `zban check`: no problems.
  - `pnpm nx run-many -t build lint test`: passed.
  - `pnpm nx format:check --all`: passed.
  - The end-to-end suite was not run, because the plugin's behaviour did not change.
