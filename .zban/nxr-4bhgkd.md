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
