---
title: Decide whether the plugin lets rustup install a missing toolchain
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-qak38j
created_at: 2026-11-13T08:49:52Z
closed_at: 2026-11-13T14:38:01Z
---

Goal: a recorded decision on what graph creation and the toolchain cache input do when a workspace's `rust-toolchain.toml` names a toolchain that rustup has not installed.

Found while building the fixtures (nxr-qak38j). With rustup 1.29.3 on Linux, on 13 November 2026, a plain `rustup show active-toolchain` in a folder whose `rust-toolchain.toml` names `1.91.0` downloaded and installed that toolchain without asking. rustup installs a missing toolchain on first use unless `RUSTUP_AUTO_INSTALL=0` is set; with it set, `rustc -Vv` in that folder fails with "toolchain '1.91.0-x86_64-unknown-linux-gnu' is not installed".

The plugin runs `cargo metadata` in each workspace root when it creates the graph (`DES-DISCOVERY`, `DES-METADATA-REPORT`) and `rustc -Vv` there as a runtime input (`DES-INPUTS`). So, as specified, `nx graph` or any task hash can download a toolchain. That conflicts with "Building the graph needs no network" in `workspaces.mara.md` and touches `ADR-V1-SCOPE` (the plugin does not install toolchains) and `REQ-CARGO-UNCHANGED` (plain cargo would install it as well). The test harness sets `RUSTUP_AUTO_INSTALL=0` for every command it runs (`nx-rust/test/harness/environment.ts`).

Options:

- Leave rustup's default: graph creation and hashing may download a toolchain, as plain cargo would.
- Set `RUSTUP_AUTO_INSTALL=0` for the plugin's graph-time commands (`cargo metadata`, the `rustc -Vv` input) only, so that a missing toolchain fails graph creation or hashing with a message that names it, while tasks keep plain cargo's behaviour.
- Set it for tasks as well.

- [x] Agree the option with the maintainer
- [x] Record the decision for graph creation in Mara (`ADR-GRAPH-NO-TOOLCHAIN-INSTALL`, `EVD-RUSTUP-MISSING-TOOLCHAIN`), with the folders of the graph-time calls, and update `DES-DISCOVERY`, `DES-METADATA-REPORT`, `VER-SETUP` and the workspaces guide
- [x] File the graph-time implementation (nxr-66wa7d)
- [x] Agree with the maintainer what the toolchain input of a task's key does when the pinned toolchain is missing. Nx 24 keys a task on the output of a failing runtime input and runs it (`EVD-RUSTUP-MISSING-TOOLCHAIN`), so the accepted error "when a task's key is computed" in `DES-DIAGNOSTICS` and `VER-SETUP` cannot come from Nx
- [x] Record that answer: `ADR-GRAPH-NO-TOOLCHAIN-INSTALL` or a decision of its own, `DES-INPUTS`, `DES-DIAGNOSTICS`, `VER-SETUP`, a case in `VER-CACHE-KEYS`, and the caching and setup guidance it changes
- [x] Add the agreed toolchain-input work to the step that nxr-fy4t4k holds for it

## Summary of Changes

Graph creation and the toolchain input of a task's key let rustup install no toolchain (`ADR-GRAPH-NO-TOOLCHAIN-INSTALL`). The maintainer chose this for graph creation and hashing on 13 November 2026, and also answered where graph-time calls run. Every graph-time cargo call runs with `RUSTUP_AUTO_INSTALL=0` in the root folder of a workspace (`DES-METADATA-REPORT`, `DES-DISCOVERY`), so a missing pinned toolchain fails graph creation with rustup's message, which names it. Tasks' cargo commands get no setting.

Reproducing it showed that Nx 24.0.6 runs a task whose runtime input fails and keys the task on the command's output (`EVD-RUSTUP-MISSING-TOOLCHAIN`). So the error that `DES-DIAGNOSTICS` and `VER-SETUP` promised "when a task's key is computed" could not come from Nx. The control plane chose, under the maintainer's standing instruction, that the toolchain input discards rustup's message and prints a random value when `rustc -Vv` fails. No stored result can then match, and the task runs as plain cargo (`DES-INPUTS`). The error is now promised at graph creation only. Rejected: failing the task from the executor (it would differ from plain cargo), keying on rustup's message (it names a channel such as `stable`, not a release), and letting hashing install the toolchain.

Changed: `DES-METADATA-REPORT`, `DES-DISCOVERY`, `DES-INPUTS`, `DES-DIAGNOSTICS` (row and paragraph), `VER-SETUP` (graph-time folders and variable; no key-time error), `VER-CACHE-KEYS` (a missing toolchain after graph creation restores no result), and the workspaces and caching guides. Implementation: nxr-66wa7d (graph time) and a step in nxr-fy4t4k (toolchain input).

Checks: rustup 1.29.3 runs on Linux with the variable set (never unset, nothing installed). The real Nx 24.0.6 hasher with the new input gave three different hashes in three failing runs, and in the success state the hash of plain `rustc -Vv` with a cache hit. `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors and 0 warnings) and `zban check` passed. No code changed, so the end-to-end suite did not run.
