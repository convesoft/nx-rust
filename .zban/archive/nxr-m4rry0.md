---
title: Print the cargo command a task runs when Nx runs verbosely
status: done
type: feature
parent: nxr-9y4eh8
discovered_from: nxr-sefq12
created_at: 2026-11-14T17:30:46Z
closed_at: 2026-11-14T19:00:48Z
---

Goal: with Nx's verbose flag, each task of the plugin prints the exact cargo command it is about to run, so that a user can reproduce the task by hand. Normal output stays as it is.

Context: the plugin prints no cargo command of its own. Since nxr-sefq12, crates are selected by the package ID that cargo reports (`DES-INVOCATION`, "Selecting a crate"), and cargo's own rerun hints (`-p good --lib`) cannot be pasted in a workspace where a package outside the workspace has a member's name. The command holds the checkout's absolute path, and Nx replays stored terminal output on other machines, which is why it stays out of normal output.

The maintainer decided on 14 November 2026, the option he chose word for word: "Only with `--verbose` (Recommended)". The options he did not take: always print it; never print it.

- [x] Record the decision in Mara (`DES-INVOCATION` or `DES-DIAGNOSTICS`, whichever owns what a task prints): what counts as verbose (Nx's `--verbose` and `NX_VERBOSE_LOGGING`, checked against the installed Nx), what is printed (the command with its arguments as run, the folder it runs in, and the variables the plugin sets for it), and that normal output and what Nx stores for a task without the flag are unchanged
- [x] Print it for every cargo command a task runs, the lookups before the main command included or left out as the design says, for single tasks; name the place for the batch executor on nxr-s12cpg
- [x] Check what the flag does to cache keys and to stored output: a verbose run must not change a task's key, and say whether its output with the command is stored
- [x] Tests with the real Nx: without the flag the output has no such line; with it the line is there and running it by hand gives the same result
- [x] The user guide says how to see the command

Done when: the checks pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

With `--verbose` or `NX_VERBOSE_LOGGING=true`, each task prints three lines on standard error right before cargo starts, after its warnings: `<project>:<target>: @convesoft/nx-rust runs cargo as these lines do in a POSIX shell:`, then `cd <workspace root>` and `cargo <arguments>`, every word quoted for a POSIX shell where needed. Variables that the plugin sets for a command are printed as `NAME=value` before `cargo`, but no command sets any yet. The task's own environment is never printed. A run without verbose mode prints nothing new. The lines come from `commandBlock` in `nx-rust/src/executors/cargo-invocation.ts`, built from the same `CargoInvocation` that `runCargo` starts cargo with. Verbose mode is Nx's own signal. A single task asks `taskRunsVerbosely`, which reads `isVerbose` in the executor's context and nothing else. A batch, whose context always says `false`, is to ask `batchRunsVerbosely` with its own process's environment, where Nx copies the run's `NX_VERBOSE_LOGGING`. The lookups before the command are not printed. The lockfile task prints its own `cargo update --workspace`. nxr-s12cpg's task list names the place for the batch executor: the batch process prints each step's lines itself, so that they belong to no task and are neither stored nor replayed.

Cache: Nx's hasher gives the same keys with and without the variable. A verbose run stores the lines with the result, because Nx 24.0.6 gives an executor no way to the terminal that it does not store, and a later hit replays them. That is accepted and documented (`ADR-VERBOSE-COMMAND`); the guide points to `--skip-nx-cache --verbose`.

Knowledge: new `REQ-VERBOSE-COMMAND`, `ADR-VERBOSE-COMMAND` (the maintainer's decision word for word, plus the control plane's choice on stored output) and `EVD-NX-24-VERBOSE`. Updated: `DES-INVOCATION` ("Printing the command"), `DES-DIAGNOSTICS`, `VER-CARGO-UNCHANGED` and `DES-UNKNOWN-OPTIONS`. The caching guide has a new section "Seeing the command", linked from the targets page.

Tests: `nx-rust/test/verbose-command.spec.ts` (fixture `shared-names`, real Nx and cargo) and `nx-rust/test/cargo-invocation.spec.ts` (quoting round trip through sh and bash; zsh is not installed here). Broken on purpose: always verbose failed 3 tests, never verbose 5, `good@0.1.0` printed in place of the specification 2, and an `env` input of `NX_VERBOSE_LOGGING` failed the key test.

Checks run after merging the local `main` at 03bb80c: `pnpm nx run-many -t build lint test` (41 suites, 1214 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 (26 passed) and again on 1.91.0 through a private `RUSTUP_HOME` (26 passed), the two new spec files on 1.91.0 (18 passed), `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no errors or warnings) and `zban check`.

Rejected: writing the lines to the controlling terminal past Nx (under Nx's pseudo-terminal it is Nx's own, there is none in CI, and it would overwrite the terminal UI); printing the command without its folder or with package names; printing the lookups; in a batch, putting the lines into each task's `terminalOutput`, which would repeat a long command once per task and store and replay it with each.

## Review fix

An independent review found that a crate's dotenv file overrode an explicit `--verbose=false`. The first version also read `NX_VERBOSE_LOGGING` from the task's environment, and Nx deletes the root `.env`'s matching value and loads the crate's `.env` into that environment. So with `NX_VERBOSE_LOGGING=false` in the root `.env` and `true` in `rust/crates/good/.env`, `nx run good:check --verbose=false` printed the command. A single task now follows `context.isVerbose` alone. The batch has a function of its own, which reads its process's environment, and nxr-s12cpg's item says so. `DES-INVOCATION`, `EVD-NX-24-VERBOSE`, `VER-CARGO-UNCHANGED` and the guide are corrected. `verbose-command.spec.ts` has the reviewer's case with the daemon off and on; with the old check restored, both of those tests failed.

Checks rerun after the fix (the local `main` was still at 03bb80c, already merged): `pnpm nx run-many -t build lint test` (41 suites, 1217 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 (26 passed) and on 1.91.0 through a private `RUSTUP_HOME` (26 passed), the two new spec files on 1.91.0 (21 passed), `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no errors or warnings) and `zban check`.
