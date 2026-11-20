---
title: Rename the wasm-build option jsFlavour to wasmTarget
status: todo
type: task
related:
  - nxr-bhh3mm
discovered_from: nxr-0ap8n4
created_at: 2026-11-20T10:31:00Z
---

Goal: the option of `wasm-build` that chooses the `--target` of the `wasm-bindgen` CLI is called `wasmTarget`, not `jsFlavour`. Its values (`bundler`, `web`, `nodejs`) and its default (`bundler`) stay.

The maintainer decided this on 20 November 2026, overturning line 31 of nxr-bhh3mm: the name matches `wasm-bindgen --target` as `targetTriple` matches `cargo --target`, and it removes the only British-spelled identifier from the public option schema. Nothing is published, so there is no alias and no migration: the old name is simply gone and is rejected like any unknown option.

- [ ] Rename it in the design first (`DES-ARTIFACT-STEPS`, the wasm design item and the options table of `configuration.mara.md`), without the "provisional" mark on the name, then in the executor's schema, the graph and executor code, the tests and the guide pages
- [ ] Rename internal identifiers and prose that say "flavour" for this option, so that code and pages use one word; other uses of the word stay
- [ ] A test shows that `jsFlavour` is now rejected as an unknown option, as the option checks of `DES-PLUGIN-OPTIONS` do for any other unknown name

Done when: `git grep -n -i "jsflavour"` finds nothing outside `.zban/`, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` and `zban check` pass.
