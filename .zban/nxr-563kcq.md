---
title: Say why a toolchain input keeps missing the cache where a configured compiler that the task's cargo does not use is missing
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-aqgka5
created_at: 2026-11-20T14:28:44Z
---

Goal: a task whose toolchain input prints a random value while the task's own cargo succeeds says why, as the plugin's script inputs now do (`DES-INPUTS`, "Failing runtime inputs").

Context: where the configuration files read as Cargo 1.91 reads them and as later versions read them name different compilers through `build.rustc` or `build.rustdoc`, the toolchain command asks both (`DES-INPUTS`, toolchain row; `EVD-CARGO-COMPILER-SELECTION`). If the one that the task's cargo does not use is missing, the whole `-Vv` chain fails and the command prints a random value at every evaluation, so the task is never restored, while cargo succeeds and nothing on the terminal says why. Found while working on nxr-aqgka5, which added the executor's warning only for the inputs that run the plugin's Node scripts: re-running the toolchain command in every executed task of every target costs a few `-Vv` calls each, for a case that needs an `include` file and a missing compiler.

- [ ] Decide whether the executor should run the toolchain command again (or only its named-compiler part) and warn, as `failedInputWarnings` in `nx-rust/src/executors/runtime-input-check.ts` does for script inputs, or whether graph creation can warn where a configured compiler does not exist
- [ ] Update `DES-INPUTS` ("Failing runtime inputs") and `VER-CACHE-KEYS` accordingly
