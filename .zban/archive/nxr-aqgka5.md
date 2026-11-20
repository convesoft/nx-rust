---
title: Improve runtime-input scripts (overhead, silent /dev/urandom fallbacks, multiline env, hashing side effects)
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
related:
  - nxr-4byqv8
created_at: 2026-11-20T10:24:49Z
closed_at: 2026-11-20T15:29:35Z
---

Goal: make runtime-input commands faster, easier to diagnose on failure, safe with multiline environment variables, and free of avoidable hashing side effects (`DES-INPUTS`, `DES-OUTPUTS`, `DES-TEST-MODE`, `GOAL-TRUSTED-CACHE`, `VER-CACHE-KEYS`).

Context: `nx-rust/src/graph/inputs.ts` generates shell runtime-input commands that invoke Node scripts (`print-artifact-folders.ts`, `print-test-mode.ts`, `print-napi-cli.ts`) with several rough edges:
- `print-artifact-folders.ts` spawns `sh` -> `node` -> `cargo metadata --no-deps` on every hash evaluation of `build` and `doc`.
- Any script failure discards stderr (`2>/dev/null`) and falls back to `od -An -N16 -tx1 /dev/urandom`, making accidental cache misses silent and hard to diagnose.
- `print-test-mode.ts` writes command record files under `.nx/workspace-data` during Nx hashing, introducing cross-task races (`nxr-4byqv8`) and requiring 24-hour stale-folder sweeps in `nx-command.ts`.
- `inputs.ts` filters `env | grep -E ... | LC_ALL=C sort` line-by-line, which mishandles environment variable values containing newlines.

- [x] Evaluate computing target/artifact directories in Node (or avoiding `cargo metadata` where `.cargo/config.toml` and env vars suffice) while keeping `DES-INPUTS` and `DES-OUTPUTS` exact
- [x] Surface diagnostics or a structured error/warning mechanism when a runtime-input script fails instead of silently hiding stderr behind `/dev/urandom`
- [x] Handle multiline environment variables cleanly in the toolchain/env runtime input
- [x] Revisit whether `DES-TEST-MODE` can avoid mutating `.nx/workspace-data` during hashing (coordinating with `nxr-4byqv8`)
- [x] Update affected Mara items (`DES-INPUTS`, `DES-TEST-MODE`, `VER-CACHE-KEYS`) if behaviour changes

Done when: agreed improvements are implemented and tested, Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.

## Summary of Changes

- Multi-line variables: the toolchain input listed `CARGO_PROFILE_*`, `CARGO_TARGET_*` and `NEXTEST_*` from the lines of `env`. That dropped a value's second line, so two flag values could share a key, and it added a variable of another name whose value held such a line. It now reads them with awk's `ENVIRON` (`variablesCommand` in `nx-rust/src/graph/inputs.ts`): one line per variable, backslash and line break escaped, sorted bytewise, and identical output for ordinary values.
- Failing script inputs: the artifact-folder, test-mode and napi-CLI inputs share `scriptInputCommand` (`nx-rust/src/graph/script-input.ts`). Where the script cannot run or fails, it still prints a random value, now after the line `@convesoft/nx-rust: this runtime input failed`. The script's stderr goes to the descriptor in `NX_RUST_INPUT_ERRORS`, which is `/dev/null` while Nx hashes. When such a task runs, `failedInputWarnings` (`nx-rust/src/executors/runtime-input-check.ts`, called last in `prepareTask`) runs those commands again with the task's environment, without `NX_RUST_COMMAND_ID`, and warns with the command and the script's error. A batch runs each command once.
- Mara: `DES-INPUTS` ("Failing runtime inputs", "Cost of the artifact folder input", the variables bullet and the table rows), `DES-TEST-MODE` ("Why hashing writes the record") and `VER-CACHE-KEYS`. New evidence `EVD-RUNTIME-INPUT-SCRIPTS`.
- Tests: new `nx-rust/test/runtime-inputs.spec.ts`. A new real-hasher row in `cache-keys.spec.ts` fails against the old pipeline and passes now. Updated `target-triples`, `test-mode` and `nextest-steps` specs, and the e2e expectations: the literal toolchain command, and one more `cargo metadata` for an executed `build`.

## Decisions made

- Artifact folders in Node: not done, and the chain stays. Computing them from Cargo's configuration would re-implement cargo's config resolution. One evaluation costs about 29 ms (Node 12.5, modules ~7, `cargo metadata` ~7). The compile cache and trimming imports saved nothing. Sharing one cargo call per workspace would need a record written during hashing and keyed by each task's environment, to save ~7 ms a task. Recorded in `DES-INPUTS` and `EVD-RUNTIME-INPUT-SCRIPTS`.
- Script failures: the key stays random, so no stable fallback, and the executor reruns the input and warns, because Nx 24.0.6 shows nothing of a runtime input. The task is not failed. A cost of ~30 ms on executed tasks only is accepted. Toolchain and wasm-bindgen failures already surface through cargo or the tool check. Recorded in `DES-INPUTS`.
- Multi-line variables: escaped one-line encoding through awk, as above. Recorded in `DES-INPUTS`.
- Test-mode record: kept. It is the only channel from hashing to the executor, and dropping it would loosen the guard of `DES-TEST-MODE`. A hook-read baseline was rejected because it relies on the task's environment being the same at hashing and at run time. Recorded in `DES-TEST-MODE`. nxr-4byqv8 is unchanged.

## Checks run

- `pnpm nx run-many -t build lint test` on the merged tree: 73 suites, 2035 passed.
- `pnpm nx format:check --all`.
- `pnpm nx e2e nx-rust-e2e`: 27 passed.
- With cargo 1.91.0 through a private `RUSTUP_HOME`: the runtime-input, target-triple, test-mode, caching and cache-key specs, and the e2e suite.
- The CI-env run (`env -u CLAUDECODE ... CI=true GITHUB_ACTIONS=true`) of the runtime-inputs, test-mode and target-triples specs.
- `mara schema validate` and `mara project validate`: valid and complete.
- `zban check`.

Follow-up: nxr-563kcq (deferred backlog), the toolchain input's silent misses where a configured compiler that the task's cargo does not use is missing.

## Review fixes

Changes after the review of d329fa9:

- **No stable key on any failure path (P1).** Every runtime command of the plugin that can fail now ends in `unrepeatableValue` (`nx-rust/src/graph/script-input.ts`): the toolchain versions, its variables, the wasm-bindgen CLI and the three script inputs. It takes 16 bytes from `od` and `/dev/urandom`. Without `od`, the shell's own `read` and `printf` encode bytes from `/dev/urandom`. If `/dev/urandom` cannot be read, it prints the shell's and parent's process ids.
- **Last variable keyed whole (P2).** The variables list ends with the line `end of variables`, because Nx trims whitespace at both ends of each stream.
- **Script failures.** The failure line now prints on a line of its own, and the artifact-folder script passes cargo's stderr on.
- **Warning wording.** The warning now says what the executor's rerun saw, and that the result is not restored only if Nx's evaluation failed the same way. Row added to `DES-DIAGNOSTICS`.
- **Documents.** `DES-INPUTS`, `VER-CACHE-KEYS` and `EVD-RUNTIME-INPUT-SCRIPTS` are updated with Nx's output handling, cost, environment of the rerun and output styles.
- **Tests.** The e2e test now checks what the toolchain command prints, not its text. The exotic cases are filed as nxr-ntvnds.

Verification:

- The new real-hasher tests in `runtime-inputs.spec.ts` run with a `PATH` of tool links, in five cases: without awk, without `od`, without both, with a failing artifact script, and with a trailing space in the last variable. They failed against the d329fa9 fallback and end line (stable keys, as reproduced in the review) and pass now.
- Nx 24.0.6 probed directly: it trims each stream's whitespace, puts stderr after stdout, and fails the command on bytes that are not UTF-8.
- The fallback ran in bash, `bash --posix`, dash and BusyBox `sh` with an empty `PATH`.

Checks after merging `main` at 01859ed:

- `pnpm nx run-many -t build lint test`: 2054 passed.
- `pnpm nx e2e nx-rust-e2e`: 27 passed.
- The runtime-input, cache-key, test-mode, target-triple and caching specs on cargo 1.91.0 through a private `RUSTUP_HOME`: 222 passed.
- The CI-env run of the runtime-inputs, test-mode and target-triples specs: 60 passed.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check`.

## Re-check fixes

Changes after the re-check of b080a4f:

- The `DES-DIAGNOSTICS` row for the runtime-input warning now sits in the three-column diagnostics table. It says that a cache hit replays the stored warning.
- Where `/dev/urandom` cannot be read, the last resort of `unrepeatableValue` now adds the time from `date`, where `date` exists, to the process ids. The fallback still runs without `date`.
- The remaining limit (no `/dev/urandom` and no `date`) and the re-check's findings on bytes that are not UTF-8 are in `DES-INPUTS`, `EVD-RUNTIME-INPUT-SCRIPTS` and nxr-ntvnds.

Checks after merging `main` at f4867b6:

- `pnpm nx run-many -t build lint test`: 2065 passed.
- `pnpm nx e2e nx-rust-e2e`: 27 passed.
- The CI-env run of the runtime-inputs, test-mode and target-triples specs: 60 passed.
- `runtime-inputs.spec.ts` on cargo 1.91.0: 13 passed.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check`.
