---
title: Make the harness's terminal runs reach Nx's terminal UI
status: todo
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-4sr6hd
  - nxr-yfh7zh
related:
  - nxr-k63csj
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:06:19Z
---

Goal: make the fixture runs that are meant to go through Nx's terminal UI actually reach it, so that the claims that rest on them are checked.

Context: `FixtureWorkspace.nxInTerminal` runs Nx through util-linux's `script`, whose terminal has no size. Nx 24.0.6 then refuses the terminal UI that `--tui` asks for ("Nx Terminal UI was not enabled as it is not supported in this environment") and falls back, so the ways of running called "the terminal UI" and "dynamic in a terminal" in `nx-rust/test/batch-runs.spec.ts` (and what `EVD-NX-24-BATCHES`, "Task environment", counts as terminal-UI runs) run another output path. Found in nxr-k63csj, which added an optional `size` to `nxInTerminal` (`stty` before Nx starts) and recorded the details in `EVD-NX-24-BATCHES`, "Tasks left out": with a size, the terminal UI starts, but neither `--tui-auto-exit` (which coerces to a countdown of 0) nor `--tui-auto-exit=true` made it exit after every task had finished, with or without a batch that left tasks out, until `timeout` ended it. With `NX_TUI_SKIP_CAPABILITY_CHECK=true` instead of a size, Nx's pseudo-terminal panicked.

- [ ] Find why the terminal UI does not exit under `script` with a size (input on the pseudo-terminal, the countdown, Nx's own handling) and make `nxInTerminal` drive it to the end without waiting for the timeout
- [ ] Give the terminal-UI and `dynamic` ways of running in `batch-runs.spec.ts` (and `dotenv-equivalence.spec.ts` if it has them) a size, and assert that Nx did not print the fallback warning
- [ ] Rerun the environment comparison of `EVD-NX-24-BATCHES`, "Task environment", through the real terminal UI and correct that item where the result differs
- [ ] Add a terminal-UI case to the tasks-left-for-a-following-batch tests in `nx-rust/test/batch-deferral.spec.ts` once the terminal UI exits on its own

Lead from the review of nxr-k63csj: the terminal UI ran a batch that left tasks out, showed both builds complete and exited with status 0 with `analytics: false` in `nx.json`, `TERM=xterm-256color`, a terminal of 120 by 35 columns and rows, and `--tui-auto-exit=true`. Compare that setup with `nxInTerminal`, `TERM` first.
