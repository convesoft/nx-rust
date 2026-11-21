---
title: Decide whether CI also installs the musl target and cargo-deny that some unit cases skip without
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-27zbta
created_at: 2026-11-21T21:00:56Z
---

nxr-27zbta made CI install the optional tools that `verification.mara.md` ("How the plugin is tested") names: nextest, cargo-affected, cargo-hakari and `wasm-bindgen`, with the wasm32 target and llvm-tools. A few unit cases still skip on the CI runner because they need something outside that list:

- `hakari-runs.spec.ts`, "with a non-host triple", and the cases of `caching-runs.spec.ts` gated by `secondTripleInstalled()`, need the `x86_64-unknown-linux-musl` standard library in rustup's default toolchain (`stable` in the `Build, lint, test and format` job).
- `executors.spec.ts`, "fails deny against a stale Cargo.lock ...", runs only where cargo-deny is installed.

The page does not promise these run in CI, so nothing is broken; this is about coverage.

- [ ] Decide with the maintainer whether CI covers them; if so, update `verification.mara.md` first
- [ ] If yes, add `--target x86_64-unknown-linux-musl` to the stable install and a pinned prebuilt cargo-deny in its own folder, as for the other tools in `.github/workflows/ci.yml`
