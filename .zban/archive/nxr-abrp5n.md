---
title: Decide what the unknown-option warning says for positional arguments after --
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T13:31:09Z
closed_at: 2026-11-13T16:45:23Z
---

Goal: the warning of `REQ-UNKNOWN-OPTIONS` says something true when a task of a target other than `run` gets positional arguments, such as `nx run api:test -- 3000`.

Nx hands such words to the task as an option named `_` (bullet "args" of `EVD-NX-OPTION-VALIDATION`, `nx-rust/docs/decisions.mara.md`), which no executor declares. Under the paragraph "Command line" of `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`), `_` is not a flag, so the line names the workspace's configuration as its source, although the words were typed on the command line.

Options:
- Recommended: treat `_` as passed on the command line under the same three conditions, with the words in place of a flag.
- Leave it as it is and say so in the guidance.
- Name positional arguments in a line of their own.

- [x] Agree the answer with the maintainer
- [x] Update `REQ-UNKNOWN-OPTIONS` or `DES-UNKNOWN-OPTIONS`, `VER-UNKNOWN-OPTIONS` and the guidance in `targets.mara.md` accordingly

Done when: the answer is accepted in Mara and `mara project validate` reports `valid: true`.

## Summary of Changes

The maintainer decided for the recommended option, relayed in the brief of nxr-wea5vt: `_` counts as passed on the command line under the same three conditions, with the words in place of a flag. Closed in the pull request of nxr-wea5vt, which implements it.

- `DES-UNKNOWN-OPTIONS`, paragraph "Command line": one sentence for positional words (the overrides hold the same words, the task's own `__overrides_unparsed__` parsed as Nx parses it gives them, and each word of that list that can be positional is among the recorded arguments).
- `VER-UNKNOWN-OPTIONS`: one sentence, `nx run <crate>:test -- 3000 serve` and `-- -- --coverage` give the command-line line for the words.
- Guidance in `nx-rust/docs/targets.mara.md`, "Options that cargo does not use": the line for positional arguments.

Checks: `mara schema validate` and `mara project validate` (valid, evaluation complete, no diagnostics); the tests in `nx-rust/test/unknown-options.spec.ts` and the end-to-end case show the line.
