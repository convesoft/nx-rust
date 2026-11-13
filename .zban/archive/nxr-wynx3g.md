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
  - `REQ-UNKNOWN-METADATA-OPTIONS`: an unknown key under a target's `options` in a metadata table fails graph creation.
  - `DES-UNKNOWN-OPTIONS`: open schema with typed options; the warning names the source (command line, `targetDefaults` key in Nx's order, or the crate folder's own files) and suggests a `filter` or an empty executor-keyed entry; a wrongly typed declared option failing the whole batch is a known limitation.
  - `ADR-UNKNOWN-OPTIONS` (`decisions.mara.md`), with the rejected alternatives.
  - `EVD-NX-OPTION-VALIDATION`: the experiments and source reading on Nx 24.0.6 behind the decision.
  - `VER-UNKNOWN-OPTIONS` (`verification.mara.md`), which verifies both requirements.
- `RISK-TARGET-DEFAULTS` now names the mitigation. `REQ-TARGET-DEFAULT-GUARD` and `DES-PLUGIN-OPTIONS` are unchanged.
- User guidance: a new section "Options that cargo does not use" in `targets.mara.md`, and a paragraph on unknown keys under `options` in `configuration.mara.md`.
- The second task item was reworded for the "warn" outcome.
- Follow-ups:
  - nxr-wea5vt: implement the warning.
  - nxr-95kg91: implement the graph-time check.
  - nxr-ctke0y: rows for `DES-DIAGNOSTICS`, which waits for nxr-dp5q0f because PR #9 has not merged.
  - nxr-a5qw2t: unknown keys in a target's configurations in Cargo metadata, a question for the maintainer.
  - nxr-26t4qt: Nx hashes `nx.json` and the project configuration into every task.
- Checks:
  - `pnpm nx format:write`.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, 0 errors, 0 warnings.
  - `zban check`: no problems.
  - `pnpm nx run-many -t build lint test`: passed.
  - `pnpm nx format:check --all`: passed.
  - The end-to-end suite was not run, because the plugin's behaviour did not change.
