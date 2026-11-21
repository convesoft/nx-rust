---
title: "Split graph/inputs.ts: toolchain and script command builders into modules of their own"
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-8jv932
  - nxr-2m21ya
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:27Z
---

Goal: `nx-rust/src/graph/inputs.ts` holds the assembly of a target's inputs, and the builders of shell commands live beside it. No behaviour changes (`DES-INPUTS`).

Context: finding 9 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: split, after the seam issues that touch the file. At 946 lines it is the largest source file. `toolchainCommand`, `variablesCommand`, `namedToolVersion` and `versionCommand` (about lines 682-827) and `artifactFoldersCommand` and `testModeCommand` (829-900) are self-contained; `nx-rust/src/graph/script-input.ts` (64 lines) already exists for script-backed runtime inputs.

- [ ] Move the four toolchain builders into `nx-rust/src/graph/toolchain-input.ts` and the two script builders into `script-input.ts`
- [ ] Move code only: no change to any command text, since the texts are part of cache keys (`VER-CACHE-KEYS`)
- [ ] Keep the `// @mara implements` markers and compare the code links before and after

Done when: `cache-keys.spec.ts` and `runtime-inputs.spec.ts` pass unchanged, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
