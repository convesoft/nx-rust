---
title: Trim redundant output-style, release, optional-tool and worker/daemon duplicates across remaining suites
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: remove remaining low-hanging integration duplication across `batch-builds`, `workspace-build`, `group-run`, the release specs, CI optional-tool specs, and small worker/daemon specs (`VER-BATCHING`, `VER-RELEASE`, `VER-TESTING`, `VER-ARTIFACTS`, `VER-SETUP`, `VER-CACHE-KEYS`).

Context: measured at `54adf17`, these remaining suites have targeted overlap worth ~50–60 s locally plus ~25–35 s in CI where optional tools are installed.

- [ ] `batch-builds.spec.ts` (lines 85–131): reduce the 4 identical non-TUI output styles (`static`, `stream`, `stream-without-prefixes`, `GITHUB_ACTIONS`) to `static` + `GITHUB_ACTIONS` (+ `--tui`); move pure runner-output/JSON-framing edge cases from `workspace-build.spec.ts` / `group-run.spec.ts` into `test-steps.spec.ts`
- [ ] Release specs (`release-registries`, `release-lockfile`, `release-version`, `release-publish`, `release-unpublished`, `release-publish-dry-run`): move pure publish-plan, registry-selection and unpublished-dependency checks to `publish-settings.spec.ts` / `publish-output.spec.ts`, keeping real `cargo publish` / `nx release` runs for uploads, retries/timeouts, lockfile updates and multi-registry routing
- [ ] Optional-tool specs (run in CI): move `coverage-baseline.spec.ts` stand-in decision logic (24 tests) and `hakari-graph.spec.ts` manifest checks (34 tests, 7.7 s) to direct in-process calls while keeping real `cargo-affected` / `nextest` / `cargo-hakari` runs intact
- [ ] Targeted trims: keep graph-only artifact-inference tests in `napi-build.spec.ts` / `wasm-build.spec.ts` out of warm-build copies; reduce `plugin-version.spec.ts` from 4 worker runs to 1; keep 1 daemon test each in `cargo-directories.spec.ts` and `compatibility.spec.ts`; evaluate skipping the Cargo 1.91 duplicate inside `sparse-registry.spec.ts` when CI already tests 1.91
- [ ] Update the corresponding clauses in `nx-rust/docs/verification.mara.md` (`VER-BATCHING`, `VER-RELEASE`, `VER-TESTING`, `VER-ARTIFACTS`, `VER-SETUP`, `VER-CACHE-KEYS`)
- [ ] Verify with temporary mutations and record before/after timings (including optional-tool suites where installed)

Done when: affected specs pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
