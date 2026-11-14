---
title: Print the cargo command a task runs when Nx runs verbosely
status: todo
type: feature
parent: nxr-9y4eh8
discovered_from: nxr-sefq12
created_at: 2026-11-14T17:30:46Z
---

Goal: with Nx's verbose flag, each task of the plugin prints the exact cargo command it is about to run, so that a user can reproduce the task by hand. Normal output stays as it is.

Context: the plugin prints no cargo command of its own. Since nxr-sefq12, crates are selected by the package ID that cargo reports (`DES-INVOCATION`, "Selecting a crate"), and cargo's own rerun hints (`-p good --lib`) cannot be pasted in a workspace where a package outside the workspace has a member's name. The command holds the checkout's absolute path, and Nx replays stored terminal output on other machines, which is why it stays out of normal output.

The maintainer decided on 14 November 2026, the option he chose word for word: "Only with `--verbose` (Recommended)". The options he did not take: always print it; never print it.

- [ ] Record the decision in Mara (`DES-INVOCATION` or `DES-DIAGNOSTICS`, whichever owns what a task prints): what counts as verbose (Nx's `--verbose` and `NX_VERBOSE_LOGGING`, checked against the installed Nx), what is printed (the command with its arguments as run, the folder it runs in, and the variables the plugin sets for it), and that normal output and what Nx stores for a task without the flag are unchanged
- [ ] Print it for every cargo command a task runs, the lookups before the main command included or left out as the design says, for single tasks; name the place for the batch executor on nxr-s12cpg
- [ ] Check what the flag does to cache keys and to stored output: a verbose run must not change a task's key, and say whether its output with the command is stored
- [ ] Tests with the real Nx: without the flag the output has no such line; with it the line is there and running it by hand gives the same result
- [ ] The user guide says how to see the command

Done when: the checks pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
