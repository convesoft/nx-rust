---
title: Check runtime inputs, task-based affected and hashing over cycles in Nx 24
status: done
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T09:17:59Z
---

Goal: confirm or refute the assumptions in `RISK-NX-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`). `DES-INPUTS`, `DES-TEST-MODE` and `ADR-ALL-DEP-KINDS` rest on them.

- [x] A runtime input is evaluated once per run and afresh on the next run, with the Nx daemon on and off
- [x] The command of a runtime input runs through a shell from the repository root, so that it can change into a workspace folder, and sees the environment of the `nx` command, with the daemon on and off (`ADR-WORKSPACE-ROOT`, `ADR-TEST-MODE-CHOICE`)
- [x] Task-based affected (the Nx 24 default) treats a changed runtime input and a changed `env` input as the cache does
- [x] Task-based affected and batched tasks select the same tasks as unbatched ones
- [x] `^` inputs hash stably, and identically on repeated runs, when two projects depend on each other
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Notes (history, before the maintainer's decision of 2026-11-13)

- Recorded as `EVD-NX-24-INPUT-SEMANTICS`; `RISK-NX-INPUT-SEMANTICS` is updated (likelihood `unlikely`, consequence `major`, now also threatening `REQ-ENV-ALLOWLIST`). The closing sentences of `ADR-ALL-DEP-KINDS` and `ADR-WORKSPACE-ROOT`, which said the check was still open, now cite the evidence.
- The finding contradicted `DES-TEST-MODE` and `DES-BATCH` in one case: in a batch, a variable from a dotenv file was in the key but not in the batch process. Changes to these items, `VER-BATCHING` and `VER-TESTING`, and a clarification of `ADR-DECLARED-INPUTS`, were proposed to the maintainer and held back until the decision. The maintainer agreed on 2026-11-13 and the changes were made; see the summary below.
- Throwaway workspace and logs used for the experiments were outside the repository and are not kept; the evidence item names versions, layout and commands.

## Summary of Changes

- Ran the experiments in a throwaway Nx 24.0.6 workspace with two real Cargo workspaces (a dev-dependency cycle, a pinned toolchain), with the daemon off and on, and recorded them as the accepted `EVD-NX-24-INPUT-SEMANTICS`. Runtime inputs are evaluated afresh for every task of every run, through `sh -c` in the repository root, with the environment of the `nx` command plus the task's dotenv files. Batched and unbatched runs select the same affected tasks and share keys, and `^` inputs hash stably over a cycle. Task-based affected ignores `env` and runtime inputs, and a batch process can run with other dotenv values than Nx hashed for its tasks.
- `RISK-NX-INPUT-SEMANTICS` rewritten (likelihood `unlikely`, consequence `major`, now also threatening `REQ-ENV-ALLOWLIST`), now mitigated by `DES-BATCH`. `ADR-ALL-DEP-KINDS` and `ADR-WORKSPACE-ROOT` cite the evidence instead of an open check.
- The maintainer agreed on 2026-11-13 to rebuilding each task's environment in a batch and splitting groups by it, and to the proposed text for `DES-TEST-MODE`, `DES-BATCH` (with `mitigates: RISK-NX-INPUT-SEMANTICS`), `VER-BATCHING`, `VER-TESTING` and the clarification of `ADR-DECLARED-INPUTS`; these were applied as agreed. The "What forms a group" guidance in `execution.mara.md` now says that differing dotenv environments also split a group.
- Rejected: failing tasks whose environment differs from the batch process's, and only documenting the gap, which would leave wrong cache entries.
- Review of the pull request (2026-11-13): the batch mismatch needs no per-task file. `.env.local` and `.local.env` with different values, or a shell value equal to a root `.env` value with another one in `.env.test`, give it too, because Nx loads the generic root files in another order at start than for a task and unloads by value. Reproduced in the throwaway workspace with the daemon off and on, recorded in `EVD-NX-24-INPUT-SEMANTICS` with the load order read from the installed source, and the prerequisite removed from `RISK-NX-INPUT-SEMANTICS`. The evidence also records that `RUSTUP_TOOLCHAIN` in one crate's `.env` changes only that crate's toolchain hash. The five agreed texts are unchanged.
- Follow-ups filed: nxr-p5pgkj (caching guide note on what `nx affected` cannot see), and from the review nxr-0haa7z (whether one Cargo workspace always shares a toolchain) and nxr-6m0mqh (update `RISK-BATCH-BEHAVIOUR`), each needing the maintainer's agreement before an accepted item changes.
- Checks run on the final tree: `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `zban check`, `pnpm nx format:check --all` and `pnpm nx run-many -t build lint test`, all passing. The end-to-end suite was not run, because no plugin behaviour changed.
