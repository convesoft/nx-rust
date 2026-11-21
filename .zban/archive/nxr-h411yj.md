---
title: Make the harness's terminal runs reach Nx's terminal UI
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-4sr6hd
  - nxr-yfh7zh
related:
  - nxr-k63csj
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:06:19Z
closed_at: 2026-11-21T12:48:11Z
---

Goal: make the fixture runs that are meant to go through Nx's terminal UI actually reach it, so that the claims that rest on them are checked.

Context: `FixtureWorkspace.nxInTerminal` runs Nx through util-linux's `script`, whose terminal has no size. Nx 24.0.6 then refuses the terminal UI that `--tui` asks for ("Nx Terminal UI was not enabled as it is not supported in this environment") and falls back, so the ways of running called "the terminal UI" and "dynamic in a terminal" in `nx-rust/test/batch-runs.spec.ts` (and what `EVD-NX-24-BATCHES`, "Task environment", counts as terminal-UI runs) run another output path. Found in nxr-k63csj, which added an optional `size` to `nxInTerminal` (`stty` before Nx starts) and recorded the details in `EVD-NX-24-BATCHES`, "Tasks left out": with a size, the terminal UI starts, but neither `--tui-auto-exit` (which coerces to a countdown of 0) nor `--tui-auto-exit=true` made it exit after every task had finished, with or without a batch that left tasks out, until `timeout` ended it. With `NX_TUI_SKIP_CAPABILITY_CHECK=true` instead of a size, Nx's pseudo-terminal panicked.

- [x] Find why the terminal UI does not exit under `script` with a size (input on the pseudo-terminal, the countdown, Nx's own handling) and make `nxInTerminal` drive it to the end without waiting for the timeout
- [x] Give the terminal-UI and `dynamic` ways of running in `batch-runs.spec.ts` (and `dotenv-equivalence.spec.ts` if it has them) a size, and assert that Nx did not print the fallback warning
- [x] Rerun the environment comparison of `EVD-NX-24-BATCHES`, "Task environment", through the real terminal UI and correct that item where the result differs
- [x] Once the terminal UI exits on its own, add one terminal-UI case to `nx-rust/test/batch-builds.spec.ts` (formerly `batch-deferral.spec.ts`) for a batch with two `build` groups. nxr-yfh7zh removed the leaving of tasks for a following batch, so the case this item first named no longer exists; say in the summary if the new case would show nothing that the other cases do not, and leave it out then

Lead from the review of nxr-k63csj: the terminal UI ran a batch that left tasks out, showed both builds complete and exited with status 0 with `analytics: false` in `nx.json`, `TERM=xterm-256color`, a terminal of 120 by 35 columns and rows, and `--tui-auto-exit=true`. Compare that setup with `nxInTerminal`, `TERM` first.

## Summary of Changes

Cause: the terminal runs inherited `TERM`, and the agent shells that ran the earlier experiments have none. With a size but `TERM` unset or `dumb`, Nx 24.0.6's terminal UI shows every task done and stays open until `timeout` ends it. With `TERM=xterm` or `xterm-256color` it closes on its own: right away with `--tui-auto-exit` or `--tui-auto-exit=true`, and after the default 3-second countdown without the flag. This was checked in a small workspace and through the plugin. Where Nx's native code reads `TERM` was not traced.

- `nx-rust/test/harness/workspace.ts`: `nxInTerminal` gives the command `TERM=xterm-256color` unless `env` sets `TERM`. It now returns `terminalUi`, which is true when Nx switched to the alternate screen.
- `nx-rust/test/batch-runs.spec.ts`: the ways "dynamic in a terminal" and "the terminal UI" get a terminal of 120 by 35. Every way in `dumpsOfRuns` runs with the same `TERM`. Each terminal run asserts that the terminal UI started exactly where the way has a size (the alternate screen), and every run that Nx printed no fallback warning; a piped run has `terminalUi: false` by construction, not by observation. All 11 ways are kept. On Nx 24.0.6 `dynamic` with a size and `--tui` reach the same renderer through different flags; both stay, as the coordinator decided in the review round (noted in `VER-BATCHING` and at `waysOfRunning`).
- `nx-rust/test/dotenv-equivalence.spec.ts` has no terminal runs, so it is unchanged.
- `nx-rust/test/batch-builds.spec.ts`: new case "under the terminal UI" (Linux only): `pa` and `pb`, two `build` groups of one batch, run under the real terminal UI. It exits on its own with status 0, makes two whole-workspace builds, leaves no stage behind, and each restored crate prints what its own command built. Review round: it also asserts that the stages of both builds carry one process id, so that one batch process ran both groups; a temporary change to `stage.ts` that gave each stage another id made that assertion fail (`processes: 2`). It does not show the batch's live cargo lines (`lines` mode of `batchLiveOutput`): the terminal UI draws only its task list until a key opens a pane, so those lines never reach the screen. That claim was taken out of the case's comment and `VER-BATCHING`, and the unit test of `batchLiveOutput` in `workspace-build.spec.ts` stays the check for it. What the case adds over the other cases is one batch process for two groups under the real terminal UI.
- `EVD-NX-24-BATCHES`: "Tasks left out" records the `TERM` cause and the runs of 21 November 2026. "Task environment" was rerun through the real terminal UI: 22 runs, with the plugin filtering out only `NX_TASK_HASH`, the output variables, `FORCE_COLOR` and the four variables the pseudo-terminal gives back. Apart from the three variables that differ between any two `nx` commands, `NX_INVOCATION_ANCESTOR_PIDS`, `NX_RUST_COMMAND_ID` and `NX_RUST_NX_COMMAND`, which the comparison leaves out, the same three variables differed and nothing else: `NX_PSEUDO_TERMINAL_EXEC_ARGV` (empty, in the six single tasks in Nx's pseudo-terminal), `NX_TUI_AUTO_EXIT=0` and `NX_VERBOSE_LOGGING`. `COLUMNS` and `LINES` did not differ. The earlier result therefore stands; the item now says that its `dynamic` and terminal-UI runs had fallen back to another output style.
- `VER-BATCHING`: names the sizes, `TERM` and the new terminal-UI case. It drops the claim that the terminal UI waits under `script` when given a size.
- `nx-rust/test/README.md`: documents `nxInTerminal(args, env, seconds, size)`, `TERM` and `terminalUi`.

Run times (jest `Time`, measured as CI runs them):
- `batch-runs.spec.ts`: 122.6 s before, 143.9 s after, on a loaded machine. The one test that changed, run alone back to back, took 36.8 s before and 32.4 s after, so the rest of the difference is load. No terminal-UI run waits for its timeout.
- `dotenv-equivalence.spec.ts`: 5.0 s before, 3.1 s after; nothing in it changed.

Checks run:
- `pnpm nx run-many -t build lint test` after merging `main` 111be70: passed, 80 suites, 2128 tests.
- `pnpm nx format:check --all`: passed.
- The three specs as CI runs them (`env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT -u CODEX_THREAD_ID CI=true GITHUB_ACTIONS=true …`): all passed.
- `mara schema validate`: valid. `mara project validate`: `valid: true`, `evaluation_complete: true`.
- `zban check`.

## Decisions made

- `nxInTerminal` sets `TERM=xterm-256color`, as a terminal emulator would, and a caller can override it. The terminal runs then no longer depend on the developer's or CI's `TERM` (harness doc comment and `nx-rust/test/README.md`).
- Only the ways that open the terminal UI get a size (120 by 35). The other terminal ways keep `script`'s terminal without a size, as before, and assert that the terminal UI did not start (`VER-BATCHING`).
- Every way in the environment comparison uses the same `TERM`, so that the tasks' environments are compared on what Nx adds, not on `TERM` (`VER-BATCHING`).
- A run counts as reaching the terminal UI when its output switches to the alternate screen (`ESC [?1049h`).
- The terminal-UI case in `batch-builds.spec.ts` is kept as the run of one batch process for two `build` groups under the real terminal UI (review round: it does not show the live cargo lines, see above).
