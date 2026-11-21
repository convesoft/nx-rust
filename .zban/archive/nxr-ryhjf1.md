---
title: Cut the startup overhead of the end-to-end suite and run its two toolchains in parallel in CI
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-aqgka5
  - nxr-yfh7zh
created_at: 2026-11-20T16:38:09Z
closed_at: 2026-11-21T12:28:17Z
---

Goal: the end-to-end suite spends its time in Nx and cargo, not in starting pnpm and fetching package metadata again, and CI runs it for the installed cargo and for Cargo 1.91 at the same time (`VER-SETUP`, `REQ-COMPATIBILITY`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026. `nx-rust-e2e` runs twice in a row in CI (`stable` and `1.91.0`), wipes pnpm's cache in every run, calls `pnpm exec nx` more than 25 times and runs `nx add` six times. It waits for nxr-aqgka5, which changes `nx-rust-e2e/src/nx-rust.spec.ts`.

- [x] Call Nx directly: change `nx()` and `nxResult()` (`nx-rust-e2e/src/nx-rust.spec.ts`, lines 1179-1204) from `pnpm exec nx ...` to `process.execPath` with `node_modules/nx/dist/bin/nx.js`, as `FixtureWorkspace.nx` does. Keep `pnpm exec nx add` for the `nx add` calls only
- [x] Keep pnpm's metadata cache for outside packages: `tools/scripts/start-local-registry.ts` (lines 25-27) wipes the whole `pnpm_config_cache_dir` in every run, so `nx` and its dependencies are fetched again through the local registry. Either publish `@convesoft/nx-rust` under a version of its own for each run (for example `0.0.0-e2e.<time>-<pid>` under the dist-tag `e2e`) or purge only the plugin's entry, so that a stale build of the plugin can never be installed
- [x] The `cargo clean` in the middle of the suite (line 648): check whether deleting only the final artifacts keeps the same cache-restore assertion without a full recompile of `subfolder-workspace`; keep `cargo clean` if the assertion would prove less
- [x] CI (`.github/workflows/ci.yml`, lines 68-101): run the `stable` and `1.91.0` end-to-end runs as two parallel matrix jobs behind a light aggregating job whose `name:` stays `End-to-end tests` (`if: always()`, failing unless both matrix jobs succeeded), so that the required check on `main` keeps its name. Linux only (`ADR-CI-LINUX-ONLY`); no macOS job. The workflow cannot be run from a worktree: say in the summary that it is checked only once the maintainer pushes, and check its syntax locally as far as that goes
- [x] Give the timings before and after

Done when: the end-to-end suite passes locally on the installed cargo and on Cargo 1.91 (private `RUSTUP_HOME`, as `AGENTS.md` describes), the timings are reported, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust-e2e/src/nx-rust.spec.ts`: `nx()`, `nxResult()` and the other direct Nx calls (daemon warning test, `nx release version`, the split-entries `show projects`) now run `node_modules/nx`'s bin script with `process.execPath`, as `FixtureWorkspace.nx` does, through the helpers `nxScript()` and `nxEnvironment()`. `nx add` keeps `pnpm exec` at its two call sites (the first install, and `nxAdd()` of the `targetDefaults` block), which run it six times in all. The assertions are unchanged.
- `tools/scripts/start-local-registry.ts`: each run publishes the plugin as `0.0.0-e2e.<ms>-<pid>` (dist-tag `e2e` kept) and passes that version to the tests in `NX_RUST_E2E_PLUGIN_VERSION` (`pluginVersionVariable` in `tools/scripts/local-registry.ts`). The tests install that exact version. pnpm's cache folder (`tmp/local-registry/pnpm-cache`, this checkout's own) is no longer wiped.
- `nx-rust-e2e/project.json`: the `typecheck` inputs cover `tools/scripts/*.ts`, because the spec now imports from `local-registry.ts`.
- `.github/workflows/ci.yml` and the local composite action `.github/actions/e2e/action.yml`: two jobs run the suite at the same time, `e2e-stable` ("End-to-end tests on Cargo stable") and `e2e-msrv` ("End-to-end tests on Cargo 1.91.0"), each a checkout followed by the composite action with its `toolchain` input. The job `e2e`, still named `End-to-end tests`, has `needs: [e2e-stable, e2e-msrv]` and `if: always()`, and fails unless `needs.e2e-stable.result` and `needs.e2e-msrv.result` are each exactly `success`, so `failure`, `cancelled` or `skipped` of either fails it. The header comment of the workflow and the last paragraph of `AGENTS.md` ("Commits") now name the two required checks and say that the per-toolchain jobs are not required checks.
- Stale-plugin check: build and run 1 (installed `0.0.0-e2e.1795262214330-890836`). Then a marker line was appended to `nx-rust/README.md` and the plugin rebuilt for run 2. Before run 2, pnpm's kept metadata for `@convesoft/nx-rust` listed only run 1's version. Run 2 published `…1795262283443-924221` and installed it: "installs the plugin that the global setup built" (digests equal `dist/nx-rust`) and "has the README…" (equal to the edited source) passed. The marker was reverted afterwards.
- Timings, each run alone on the machine (`berth --exclusive`), with `--skip-nx-cache`; Jest time / Nx run duration including the build:
  - installed cargo 1.100.0: before 24.5 s / 31.0 s (two runs), after 20.9 s / 26.8 s and 22.9 s / 29.0 s;
  - Cargo 1.91.0 (private `RUSTUP_HOME`): before 24.8 s / 31.0 s, after 21.4 s / 28.1 s.
  - Locally that saves about 2 to 4 s per run. The test project's `pnpm install` took about 1.7 s even with the old wiped cache, so most of the saving comes from the direct Nx calls. In CI the two toolchains no longer run one after the other, so the wall-clock time of the check should drop to about one run plus the gate job. This is a projection, not a measurement: it depends on both jobs getting a runner at once, and each job now installs Node, pnpm and the dependencies on its own.
- Checks run: `pnpm nx run-many -t build lint test` (pass, 2127 tests), `pnpm nx format:check --all` (pass), `pnpm nx e2e nx-rust-e2e` on the installed cargo (pass, also on the final formatted code) and on Cargo 1.91.0 (pass). `actionlint` 1.7.12 with shellcheck 0.11.0 on the workflow (pass); it reads the local action and rejects a misspelled or missing `toolchain` input, as a probe copy showed. The gate was read against GitHub's documentation of `needs.<job_id>.result` (`success`, `failure`, `cancelled` or `skipped`). The workflow itself has not run: whether both jobs start in parallel, the local action resolves after the checkout, and the gate reports `End-to-end tests` under the branch protection is checked only once the maintainer pushes.

## Decisions made

- A unique version for each run, installed by that exact version, instead of purging the plugin's entry from pnpm's cache: the cache's layout is pnpm-internal, while a version that no cache knows forces pnpm to fetch fresh metadata. This holds for both pnpm's metadata cache and its store.
- pnpm's cache stays in this checkout's `tmp/local-registry/pnpm-cache` rather than the user's shared one, so that other checkouts' registries on the same port add nothing to it.
- `INIT_CWD` is dropped and `NX_TUI=false` is set for direct Nx calls, matching `FixtureWorkspace.nx`. `pnpm exec` sets `INIT_CWD` to its own folder, and Nx's generators read it.
- `cargo clean` is kept. The case it serves checks build reuse between Nx's tasks and plain cargo, in both orders, with Nx's cache off (`--skip-nx-cache`); it is no cache-restore assertion, as the task item called it. `subfolder-workspace` has only four path crates and no registry dependency, so every unit is a member's final artifact. Deleting only the uplifted artifacts would let cargo relink them without compiling, so "plain cargo from scratch" would prove less, and a full rebuild of the fixture is cheap anyway.
- Two jobs in place of a matrix: the orchestrator's decision after the review. GitHub does not document how it combines a matrix's legs into one `needs.<job_id>.result`, and a public run showed such a gate green after one leg was cancelled before it got a runner. With two jobs, the gate checks each toolchain's result on its own. Their shared steps are a local composite action rather than a reusable workflow, whose jobs would report under a `caller / callee` name, or YAML anchors, which would still repeat each job's frame and which GitHub has supported for a shorter time; actionlint checks the composite action's inputs. The jobs are named "End-to-end tests on Cargo <toolchain>", so that neither can be mistaken for the required check.
