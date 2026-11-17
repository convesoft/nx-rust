---
title: Restrict the ignored-input check of affected runs to declared files
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-tabkjx
created_at: 2026-11-16T21:57:46Z
---

Goal: an affected run falls back to the full suite only for a declared input that git ignores, as step 1 of `DES-TEST-RUN` names it, and not for every ignored input of the group's `test` tasks.

Context: nxr-tabkjx checks every file of the group's `test` inputs with `git check-ignore`, because the plugin reads the inputs as Nx lists their files and cannot tell which pattern added one ("How steps 1 to 3 are carried out" in `DES-TEST-RUN`). An input that the plugin itself hashes although git ignores it then also runs the full suite. That is safe and costs only savings.

- [ ] Match the ignored files against the filesets of `fileInputs` (`declaredFiles` in the `test` metadata) and the plugin's own `includeIgnored` inputs, and decide which of them git must be able to see
- [ ] Update the point in `DES-TEST-RUN` and its test in `affected-coverage.spec.ts`
