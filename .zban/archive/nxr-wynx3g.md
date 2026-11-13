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
- [x] The recorded rule makes the warning for an unknown option name the option and the task and say whether it was passed on the command line or comes from the workspace's configuration (`NEED-CLEAR-FAILURES`); the maintainer chose to warn, so no unknown option fails a task

Done when: the decision is accepted in Mara and `mara project validate` reports `valid: true`.

## Summary of Changes

- The maintainer answered the decision brief on 13 November 2026, and decided two further points the same day after the second review. Recorded as accepted items:
  - `REQ-UNKNOWN-OPTIONS` (`configuration.mara.md`): an option the executor does not know, from a target default, `project.json`, `package.json` or the command line, is ignored with one warning line per option in the task's output. It satisfies `NEED-CLEAR-FAILURES` and mitigates `RISK-TARGET-DEFAULTS`.
  - `REQ-UNKNOWN-METADATA-OPTIONS`: an unknown key under a target's `options` or under one of its configurations in a metadata table, the `[workspace.metadata.nx.project]` table included, fails graph creation. Configurations were settled on 13 November 2026 as following from answer 5, on the same ground: the plugin owns that source and knows its option list when the graph is built.
  - `DES-UNKNOWN-OPTIONS`:
    - Open schemas with typed options.
    - The maintainer's second decision on the line: it says "passed on the command line" only when three conditions hold. The task's overrides hold the option with the value the invocation received. The task's own `__overrides_unparsed__` lists it as a flag. The `nx` command's arguments, which a `preTasksExecution` hook records, contain it. Otherwise the line says the option comes from the workspace's configuration, names `nx show target <project>:<target> --json`, and gives the two fixes for a `targetDefaults` entry. The executor no longer works out a file or key itself.
    - A target that another executor starts in code through devkit's `runExecutor` is covered by the maintainer's decision, taken after three reviews of these paragraphs. The conditions are evaluated as they stand, against the caller's task and the options Nx merged. Nothing is promised beyond ignoring the option with a line, and no task fails because of it, and the verification checks only that. The decision also named "a line in the task's output", but that is not promised: when the caller runs in a batch, a cache hit of the caller does not replay the line. The reviewers' reproductions stay in the evidence. A word after a second `--` stays positional and does not count.
    - On `run`, the `args` option and the arguments after `--` go to the binary. Arguments after `--` are forwarded only when the record has `--`, the task's own `__overrides_unparsed__` equals them, and the invocation holds the undeclared options parsed from them. A dependency or continuous task reached with `params: "ignore"` inherits the record but forwards nothing.
    - A wrongly typed declared option fails every task that Nx hands to the batch implementation, and only the affected tasks without a batch. This is a known limitation.
  - `ADR-UNKNOWN-OPTIONS` (`decisions.mara.md`), with the rejected alternatives, now including naming the file or key.
  - `EVD-NX-OPTION-VALIDATION`: the experiments and source reading on Nx 24.0.6. It now includes forwarded options, records inherited by dependencies, the `--args` forms, scoped hashing with `metadata.scriptContent`, and why the exact source cannot be recomputed from the executor's context. It also records the configurations tried with targets started in code, as observations.
  - `VER-UNKNOWN-OPTIONS` (`verification.mara.md`), which verifies both requirements. It covers both forms of the line, the forwarded-options case and the earlier counterexamples as general-form cases, `run` with `--` and `--args`, and every metadata table with its configurations.
- `DES-TARGET-COMMANDS` (`targets.mara.md`), by the maintainer's second decision:
  - `run` takes an `args` option, a string. It is split at blanks outside quotes, quotes and backslashes work as in a POSIX shell, nothing is expanded or treated as an operator, and an unterminated quote is an error naming the option. A value that looks like a number arrives from Nx as a number and is rejected, so it needs a blank (`--args=" 3000"`) or `--`.
  - Arguments after `--` still go to the binary, with two limits from Nx: flags before `--` are dropped, and arguments after it are checked as options.
  - `VER-TARGETS` covers them.
- `RISK-TARGET-DEFAULTS` now names the mitigation. `REQ-TARGET-DEFAULT-GUARD` is unchanged.
- Reconciled with #16 (nxr-9f4w3f), which accepted `DES-PLUGIN-OPTIONS`:
  - `args` is listed next to `bin` in its table of target options and in the guidance table, as `DES-TARGET-COMMANDS` defines it.
  - Its rule for unknown keys points to `REQ-UNKNOWN-METADATA-OPTIONS` for target options.
  - `DES-UNKNOWN-OPTIONS` says that Nx's `--verbose` adds no option and draws no line, because no schema declares `verbose` or sets `additionalProperties: true`.
  - The diagnostics table and `VER-SETUP`'s list of `init` cases hold both pull requests' rows.
- Merged with #15 (nxr-qv2cq5) as well. Its `fileInputs` rows and sentences, its diagnostics row and its verification cases are kept unchanged, and `VER-SETUP`'s list holds its case and mine.
- `DES-DIAGNOSTICS` (`setup.mara.md`, accepted in #9) has two new rows: the task-start warning and the graph-time error. `VER-SETUP` lists the graph-time error among the cases for which `init` fails and leaves `nx.json` unchanged.
- User guidance: a section "Options that cargo does not use" and the `args` option under "Running binaries" in `targets.mara.md`, and a paragraph on unknown keys under `options` in `configuration.mara.md`.
- The second task item was reworded for the "warn" outcome.
- Follow-ups:
  - nxr-wea5vt: implement the executors' handling and `args`.
  - nxr-95kg91: implement the graph-time check.
  - nxr-26t4qt: say in the cache design what Nx hashes beyond the declared inputs.
  - nxr-abrp5n: what the line says for positional arguments after `--`, which Nx hands over as `_`.
- Checks, on the final commit of each round:
  - `pnpm nx format:write`.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, 0 errors, 0 warnings.
  - `zban check`: no problems.
  - `pnpm nx run-many -t build lint test`: passed.
  - `pnpm nx format:check --all`: passed.
  - The end-to-end suite was not run, because the plugin's behaviour did not change.
