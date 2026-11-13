---
title: Key a task on the target-specific variables of a triple given on the command line
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:03:14Z
---

Goal: a change of `CARGO_TARGET_<TRIPLE>_LINKER`, `_RUSTFLAGS` or `_RUNNER` changes the key of every task that builds for that triple.

Context: `DES-INPUTS` lists those variables "for the host triple and for every target triple a target is configured with", and nxr-fy4t4k declares them for the host's triples and for the `targetTriple` in a target's options and configurations (`environmentInputs` and `configuredTriples` in `nx-rust/src/graph/inputs.ts` and `caching.ts`). A triple given only on the command line, as in `nx build api --targetTriple=aarch64-unknown-linux-gnu`, reaches the key as an option, but its variables do not: graph creation cannot know it. With a new `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER`, Nx would restore a result linked by the old linker (`GOAL-TRUSTED-CACHE`). A triple that `CARGO_BUILD_TARGET` or `build.target` chooses has the same gap, and nxr-3svm6z asks how the plugin learns such a triple.

Options for the maintainer:

- A runtime input that prints every `CARGO_TARGET_*` variable of the task's environment, sorted (`env | grep '^CARGO_TARGET_' | sort`), in place of the per-triple `env` inputs. Covers every triple, costs one more command per task, and also hashes `CARGO_TARGET_DIR`. Recommended. Like every runtime input, it makes no task affected (`RISK-NX-INPUT-SEMANTICS`).
- Keep the per-triple inputs and document that a triple given on the command line needs its variables added through `envInputs`.

- [ ] Decide with the user and update `DES-INPUTS` and the caching guide
- [ ] Implement it, with a `VER-CACHE-KEYS` row for a triple given on the command line

Done when: the user has agreed to the answer, the items are accepted, and `mara schema validate`, `mara project validate`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
