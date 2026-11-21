---
title: Review the decisions made in 1.0
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-21T21:14:00Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 1.0 (nxr-nm0jd6) and the three issues that he asked for before it (nxr-hh3kwy, nxr-27zbta, nxr-c63t0r) were built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (anything that cannot be undone, a capability users see) that can still be undone before 1.0 and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. nxr-hh3kwy (21 November 2026): the guide's text on the warm-cache limit of the same-folder `build` refusal says what a restore really leaves, not what the first draft promised. The review showed, and a fixture with the plugin confirmed, that Nx removes no file on a restore and that a `build` stores a file left at one of its declared output paths although it did not produce it (a binary with `required-features`, after a build with the feature or a plain `cargo build --features`). So the advice "run it in a command of its own" was replaced by "a task that reads the folder should read only the files it needs", `DES-BATCH` was corrected the same way, and `DES-OUTPUTS` gained one sentence that states the limit. The limit itself was filed in the backlog as nxr-m1tfp3 and not fixed, because the issue was a change of wording and nxr-m1tfp3 is two steps from an issue of the run; the control plane recommends deciding it before 1.0, since the stored file can come from older sources than the key describes (`GOAL-TRUSTED-CACHE`). Rests on `DES-OUTPUTS`, `DES-BATCH`, `ADR-STAGED-BUILDS`. To undo: take nxr-m1tfp3 out of the backlog, or reword the guide. The fix round was verified by the control plane's own reading against the reviewer's and the worker's facts, without a second reviewer, because it changed wording only.

2. nxr-27zbta (21 November 2026): the Linux job `Build, lint, test and format` installs more than the four items the issue listed: also cargo-affected 0.4.1 and the `llvm-tools` component, because `verification.mara.md` names cargo-affected among the tools CI installs and `affected-coverage.spec.ts` needs both with nextest. The tools are prebuilt releases pinned by version and SHA-256 (cargo-nextest 0.9.152, cargo-hakari 0.9.39, wasm-bindgen 0.2.130, the versions the docs' evidence used and the one the `wasm-packages` fixture locks); cargo-affected, which publishes no binary, is built with its own lockfile where the cache of GitHub Actions has no entry and restored otherwise. Each tool sits in a folder of its own outside the Cargo home, so that the missing-tool cases can still hide it. The job's time limit went from 25 to 35 minutes. The cases that need the musl target or cargo-deny still skip in CI, since `verification.mara.md` does not promise them (backlog nxr-ty0a0k). Nothing of this ran on GitHub: the review was by reading (URLs, digests, archive layouts and cache steps checked against upstream), and the live run is nxr-vqe9kb. Rests on `ADR-CI-LINUX-ONLY` and "How the plugin is tested" in `verification.mara.md`. To undo: remove the steps of a tool from `.github/workflows/ci.yml` and its sentence from `verification.mara.md`; the tests then skip with their warning as before.
