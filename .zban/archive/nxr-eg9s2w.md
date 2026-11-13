---
title: Add the init and crate generators
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T14:25:37Z
---

Goal: `nx add @convesoft/nx-rust` sets the plugin up, and `library` and `binary` generators create crates.

Implements `REQ-INIT` and `REQ-CRATE-GENERATORS` (`nx-rust/docs/setup.mara.md`). Checked by `VER-SETUP`.

- [x] `init` registers the plugin in `nx.json` and reports missing tools; it writes nothing into crates
- [x] `library` and `binary` wrap `cargo new` and add the crate to the workspace members once
- [x] `generators.json` and the `nx add` entry point in the package

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `init` (`nx-rust/src/generators/init/`) takes no options. It checks, then registers, then reports. The check runs the plugin's own `createNodes` for each of its entries through Nx's project-configuration step (`retrieveProjectConfigurations` with `LoadedNxPlugin`, as `@nx/devkit`'s `addPlugin` does), with the `nx.json` that registration would give. It therefore sees the manifests, `include`, `exclude` and context that graph creation sees, and runs every check that graph creation runs, without copying any. A failure stops `init` with Nx's message before anything is written. `init` adds `@convesoft/nx-rust` to `plugins` and touches no other key; an existing entry stays byte for byte. The report lists missing tools: warnings where the configuration needs them, one "not needed by your settings" line otherwise. It names the workspaces whose build directory lies inside the repository, with the suggested `build.build-dir`, and in a repository without `Cargo.toml` it says how to create a crate.
- The table of tools (`nx-rust/src/tools/optional-tools.ts`) finds cargo subcommands in the Cargo home and on `PATH`, the napi CLI also in `node_modules/.bin`, and the wasm target in the sysroot of the repository's rustc, run with `RUSTUP_AUTO_INSTALL=0`. Only cargo-deny can be needed so far, where a workspace root has a cargo-deny configuration file. The other conditions come with their features, and a step for each is in nxr-jb6g5y, nxr-tabkjx, nxr-k64tm5, nxr-0ap8n4 and nxr-tv3r95. nxr-t1ht7j got a step to share the cargo-deny file names.
- `library` and `binary` (`nx-rust/src/generators/crate/`) take `directory` (the first positional, resolved as Nx resolves it), `name` and `edition`. They find the enclosing workspace by reading manifests with smol-toml, a new dependency. They stop without running cargo when an `exclude` entry covers the folder, matched as Cargo matches it: as a path, not a glob. They say when the crate will be standalone, and under `--dry-run` they print the cargo command. Otherwise the callback runs `cargo new --vcs none` in the repository root and fails with cargo's message.
- `generators.json`, and `generators`, `@nx/devkit` and `smol-toml` in `nx-rust/package.json`. The schemas do not set `additionalProperties: false`, as Nx's own generators do not: Nx hands `--skipProjectGraph` to the generator as an option, and the schema would reject it.
- Test harness: a fixture copy links the plugin package, so `nx g` runs the generators from source. `nx()` takes a `cwd`, and `repositoryFiles`, `changedFiles` and `withoutColours` are new.
- The status note of `setup.mara.md` says what works.

Checks run: `nx-rust/test/init.spec.ts` (20 tests) and `nx-rust/test/crate-generators.spec.ts` (17 tests), with a real cargo and Nx in fixture copies, cover these parts of `VER-SETUP`: the schemas; `init` writes `nx.json` only; the report of tools for every row, cargo-deny's condition included; build directories inside and outside the repository; a repeated run on an entry with options; `--dry-run`; a repository without `Cargo.toml`, with no cargo call and a positive control; and `init` stopping, with `nx.json` unchanged, when cargo is missing or `cargo metadata` fails. For the generators they cover equality with plain `cargo new --vcs none` where folders on the way do not exist and no `.git` is created; a glob member; a missing `members` list; `name` and `edition`; `[workspace.package]`; `directory` from a subfolder; `exclude`; a standalone crate; `--dry-run`; an existing folder; and the nearest and invalid enclosing manifests. The end-to-end suite runs the real `nx add @convesoft/nx-rust@e2e` from the local registry: nothing but `nx.json` and the package manager's files changes, there is one cargo call, and the installed `library` generator runs. `pnpm nx run-many -t build lint test` passes (100 tests). A first run exited 1 on Nx's internal "DB transaction error" after every target had succeeded; the rerun was clean. `pnpm nx format:check --all` passes, and so does `pnpm nx e2e nx-rust-e2e` with a private pnpm cache (8 tests). `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation, and `zban check` finds no problems. `mara related DES-GENERATORS` lists the seven implementing declarations.

Parts of `VER-SETUP` that wait for other issues:

- The version checks and the remaining graph-time errors in `init`, the name collision included: nxr-q6cxt3 (step added).
- The graph-time warnings that `init` prints: nxr-fy4t4k (step added) and nxr-7vmkx2.
- `init`'s report of target defaults: nxr-d3087e (step added).

Found and filed: nxr-jf9dtr (`EVD-CARGO-NEW`'s exclude experiment used a glob, which Cargo does not read as one) and nxr-7vmkx2 (no issue owned the warning about Cargo directories that Nx does not ignore).
