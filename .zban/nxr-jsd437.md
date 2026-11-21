---
title: The same-folder build refusal names the parent of a directory output that both builds declare
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-hh3kwy
created_at: 2026-11-21T21:03:14Z
---

Goal: the refusal of two `build` tasks of one crate into one folder (`DES-BATCH`, "Files that a batch stores") names the folder they share, also where both declare the same directory as an output.

Context: found in the review of nxr-hh3kwy. `sharedOutput` in `nx-rust/src/executors/stage.ts` returns the parent directory (`dirname`) for two equal output paths. For the inferred per-file outputs that is the profile folder, which is right. Where a project widens both targets' outputs to the same explicit directory, such as the whole profile folder to cache more files, the message names that directory's parent instead. Both tasks are still refused, and the advice to run them in separate commands still applies.

- [ ] Name the directory itself where the shared output is a directory both tasks declare, and keep the profile folder for per-file outputs
- [ ] Add a regression case to the existing refusal tests
