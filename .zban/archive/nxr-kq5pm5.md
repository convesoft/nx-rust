---
title: Specify the remaining targets and the workspace project
status: done
type: task
priority: high
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T09:42:21Z
---

Goal: turn the draft items `DES-TARGET-COMMANDS`, `DES-WORKSPACE-TARGETS` and `REQ-RUN-WATCH` (`nx-rust/docs/targets.mara.md`) into accepted knowledge, or retire what is not wanted.

- [x] Answer the open questions in the three items with the user: exact commands and flags of `check`, `lint`, `fmt-check`, `fmt`, `doc`, `bench` and `run`; which workspace targets exist without their tool; whether `run` becomes a continuous task in v1
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer answered the fifteen questions of the decision brief on 2026-11-13, each with the recommended option.

- `DES-TARGET-COMMANDS` is accepted. It now holds the commands of `check`, `lint`, `fmt-check`, `fmt`, `bench` and `run`, with `--all-targets` coming from an option that is on by default, and states that no target adds a flag that denies warnings. `fmt` is per crate. `bench` has `parallelism: false`. `run` uses an executor without a batch implementation, is not continuous, and selects the binary through an option. The item also satisfies `REQ-CARGO-UNCHANGED` now.
- `DES-WORKSPACE-TARGETS` is accepted with `doc` (`cargo doc --no-deps --workspace`), `audit`, `deny` (only with a cargo-deny configuration) and `update`. Their existence never depends on installed tools, `audit`, `deny` and `update` are uncached but declare inputs, and `update` ignores locked mode. The name point is gone; it is nxr-gdt96k's, in `DES-PROJECT-GRAPH`.
- `REQ-RUN-WATCH` is retired.
- These accepted items changed as agreed:
  - `DES-TARGETS`: where each target exists, and the workspace targets.
  - `ADR-NX-TARGET-NAMES`: the reason for keeping `check`.
  - `DES-INPUTS`: `CARGO_BUILD_WARNINGS`.
  - `TERM-WORKSPACE-PROJECT`: documentation instead of formatting.
  - `DES-OUTPUTS`: the whole doc folder, and no caching of `doc` when workspaces share an artifact directory.
  - `DES-INVOCATION`: `update` never passes `--locked`.
- New accepted evidence: `EVD-CARGO-TARGET-COMMANDS`, `EVD-CARGO-AUDIT-DENY` and `EVD-NX-24-TARGETS`.
- Extended verification: `VER-TARGETS`, `VER-CARGO-UNCHANGED`, `VER-CACHE-KEYS` and `VER-CONFIGURATION`.
- Guidance updated in the targets, caching, workspaces, setup, CI, product and index pages.
- Task lists of nxr-t1ht7j, nxr-kmdpgj, nxr-gdt96k and nxr-fy4t4k brought in line. nxr-g4arav filed for the missing diagnostics row.

Checks run:
- `pnpm nx format:write`
- `mara schema validate`: valid.
- `mara project validate`: `valid: true`, evaluation complete, 0 errors, 0 warnings, 28 policy checks passed.
- `zban check`: no findings.
- `pnpm nx run-many -t build lint test`: succeeded for 2 projects.
- `pnpm nx format:check --all`: clean.

No code changed, so the end-to-end suite was not run.
