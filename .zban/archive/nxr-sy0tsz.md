---
title: Rename the wasm-build option jsFlavour to wasmTarget
status: done
type: task
related:
  - nxr-bhh3mm
discovered_from: nxr-0ap8n4
created_at: 2026-11-20T10:31:00Z
closed_at: 2026-11-20T10:57:31Z
---

Goal: the option of `wasm-build` that chooses the `--target` of the `wasm-bindgen` CLI is called `wasmTarget`, not `jsFlavour`. Its values (`bundler`, `web`, `nodejs`) and its default (`bundler`) stay.

The maintainer decided this on 20 November 2026, overturning line 31 of nxr-bhh3mm: the name matches `wasm-bindgen --target` as `targetTriple` matches `cargo --target`, and it removes the only British-spelled identifier from the public option schema. Nothing is published, so there is no alias and no migration: the old name is simply gone and is rejected like any unknown option.

- [x] Rename it in the design first (`DES-ARTIFACT-STEPS`, the wasm design item and the options table of `configuration.mara.md`), without the "provisional" mark on the name, then in the executor's schema, the graph and executor code, the tests and the guide pages
- [x] Rename internal identifiers and prose that say "flavour" for this option, so that code and pages use one word; other uses of the word stay
- [x] A test shows that `jsFlavour` is now rejected as an unknown option, as the option checks of `DES-PLUGIN-OPTIONS` do for any other unknown name

Done when: `git grep -n -i "jsflavour"` finds nothing outside `.zban/`, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

The `wasm-build` option `jsFlavour` is now `wasmTarget`, with the same values and default and no alias. Mara first: `DES-WASM` (the name is no longer provisional; the default `bundler` and the folder `pkg` stay provisional), the guide tables and "Things to know" and `DES-ARTIFACT-STEPS` in `artifacts.mara.md`, the options tables and option prose of `configuration.mara.md`, and the diagnostics table of `setup.mara.md`. Code: the executor schema, `command.ts`, `wasm-build.ts`, `graph/targets.ts` and `graph/wasm.ts` (`wasmTargets`, `WasmTarget`, `defaultWasmTarget`), with comments, the error message and prose saying "wasm target" instead of "JS flavour"; tests in `wasm-build.spec.ts` and `configuration.spec.ts`. A new case in `configuration.spec.ts` ("options in the target tables") shows that `jsFlavour` under `wasm-build`'s options fails graph creation as an option the executor does not know. No fixture set the option.

Checks, after merging `main`: `git grep -n -i jsflavour` finds only the new test outside `.zban/`; `pnpm nx run-many -t build lint test --skip-nx-cache` with the 1.100.0 toolchain (wasm triple) and the `wasm-bindgen` CLI: 68 suites, 2036 passed, 11 skipped, 2 todo, all 15 cases of `wasm-build.spec.ts` ran and passed; `pnpm nx e2e nx-rust-e2e`: 27 passed; `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid); `zban check`.
