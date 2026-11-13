---
title: Let run take a binary and the binary's arguments in one command
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T12:03:46Z
---

Goal: a user can choose the binary of `run` and pass arguments to it in one `nx` command, or the documentation says how to do it instead.

`DES-TARGET-COMMANDS` (`nx-rust/docs/targets.mara.md`) lets the option that passes `--bin` be set on the command line, and sends the arguments after `--` to the binary. `EVD-NX-OPTION-VALIDATION` (`nx-rust/docs/decisions.mara.md`, bullet "Command line") found that when an `nx` command has `--`, Nx 24.0.6 hands the task only the arguments after it, and drops without a message the flags before it that Nx does not know itself, an option of the target included. So `nx run api:run --bin server -- --port 3000` loses the choice of binary, and `nx run api:run -- --bin server --port 3000` gives both to the binary (`DES-UNKNOWN-OPTIONS`).

Options: document that the binary is then chosen in the crate's metadata or through an Nx configuration (`-c` survives, because Nx knows it), or have the plugin read the option from the arguments before `--` that its `preTasksExecution` hook receives.

- [ ] Agree the answer with the maintainer
- [ ] Update `DES-TARGET-COMMANDS`, the guidance on `run` and `VER-TARGETS` accordingly

Done when: the answer is accepted in Mara and `mara project validate` reports `valid: true`.
