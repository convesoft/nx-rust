---
title: Ask cargo-affected upstream to handle a workspace below the top of its git repository
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-hvw1rq
created_at: 2026-11-16T12:28:27Z
---

Goal: drop the `diff.relative` workaround of step 1 of `DES-TEST-RUN` once cargo-affected compares workspace-relative paths itself.

cargo-affected 0.4.1 selects nothing for a workspace in a subfolder of its git repository (`EVD-CARGO-AFFECTED-REPORT`). Reporting it upstream is the maintainer's call, since it is outward-facing.

- [ ] Ask the maintainer whether to report it to max-sixty/cargo-affected
- [ ] When a release fixes it, remove the workaround where the plugin's minimum cargo-affected allows it

Checked upstream on 19 November 2026, at the maintainer's request: it is not reported. None of the 26 issues of max-sixty/cargo-affected (2 open, 24 closed) and none of its pull requests is about a workspace below the top of its git repository; the notes of v0.4.1, the latest release, do not mention it; and `src/project.rs` on its `main` still runs `git diff` in the project root without `--relative` and takes the paths as relative to the project root. Whether to report it is still the maintainer's call.
