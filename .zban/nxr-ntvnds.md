---
title: "Close the exotic gaps of runtime inputs: a killed shell, bytes that are not UTF-8, names that are not identifiers"
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-aqgka5
created_at: 2026-11-20T16:16:40Z
---

Goal: no runtime input of the plugin gives a stable key, or fails a command, in the rare cases that the review of nxr-aqgka5 found (`DES-INPUTS`, "Failing runtime inputs"; `GOAL-TRUSTED-CACHE`).

Context, each found in the review of nxr-aqgka5 and left out of it as exotic:
- A signal that kills the outer `sh` of a runtime input before its fallback runs leaves the output empty, which repeats, so the key is stable for that evaluation.
- Bytes that are not UTF-8, as the re-check of the review of nxr-aqgka5 established at 9d3430a, d329fa9 and b080a4f: invalid bytes that arrive through the task's environment collapse to one key; invalid bytes that a command prints directly, on standard output or standard error, abort Nx's hashing ("invalid utf-8 sequence"). The toolchain input printed such a byte of a `CARGO_*` value at d329fa9 and b080a4f in both locales tested, and at 9d3430a in the `C` locale, while under `C.UTF-8` its `grep` filtered the byte. awk could escape every byte of 0x80 and above.
- The last resort of `unrepeatableValue` (`nx-rust/src/graph/script-input.ts`) where `/dev/urandom` cannot be read: it prints the process ids of the shell and its parent, which repeat in fresh process namespaces (two such runs gave one key, and the second hit the cache), and the time from `date` where `date` exists; without `date` it repeats.
- dash leaves out of the environment that it hands its commands every variable whose name is no shell identifier, so awk's `ENVIRON` does not see such a `CARGO_PROFILE_*` variable, while cargo would.

- [ ] Decide for each whether it needs a fix, with the evidence, and record it in `DES-INPUTS` and `EVD-RUNTIME-INPUT-SCRIPTS`
- [ ] Fix the ones that need it, with tests through Nx's own hasher
