---
title: Add PLUGIN.md and bundle nx-rust/docs in the published npm package
status: done
type: task
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T11:43:28Z
---

Cites: `ADR-PUBLISHING-AT-1-0`, `DES-PLUGIN-OPTIONS`, `DES-TARGETS`, `DES-INPUTS`.

Maintainer decision (22 Nov 2026): add `PLUGIN.md` and bundle all files in `nx-rust/docs/` as-is in the published `@convesoft/nx-rust` npm package so AI agents and developers in adopting repositories can read version-matched documentation directly through `node_modules/@convesoft/nx-rust/`.

- [x] Add a concise, agent-friendly `nx-rust/PLUGIN.md` (following Nx 24's `PLUGIN.md` convention for plugins) summarizing common commands, `Cargo.toml` metadata overrides, caching rules, and pointing to the bundled `docs/` folder
- [x] Update `nx-rust/project.json` build `assets` to copy `PLUGIN.md` (already matched by `*.md`, confirm) and all of `nx-rust/docs/` into `dist/nx-rust/docs/` without modifying the docs themselves
- [x] Update `nx-rust/README.md` to mention `PLUGIN.md` and the bundled `docs/` alongside the GitHub documentation link
- [x] Add a packaging test (or check in existing build/e2e tests) verifying `PLUGIN.md` and `docs/*.mara.md` are present in `dist/nx-rust/` and the published tarball (`npm pack --dry-run`)

Done when: `pnpm nx build @convesoft/nx-rust` outputs `dist/nx-rust/PLUGIN.md` and all `dist/nx-rust/docs/*.mara.md`, `npm pack --dry-run` includes them, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.

## Summary of Changes

- Added `nx-rust/PLUGIN.md`: what the plugin does, how to tell it is active, a table of common commands, the `Cargo.toml` metadata tables, the caching rules, and links into the bundled `docs/` for everything else. It restates no item text; the links point at the user-guide sections that the items back (`DES-TARGETS`, `DES-PLUGIN-OPTIONS`, `DES-INPUTS`).
- `nx-rust/project.json`: a build asset copies every file of `nx-rust/docs/` as it is into `dist/nx-rust/docs/`. `PLUGIN.md` was already copied by the `*.md` asset of the project root (confirmed in `dist/nx-rust/`). The build's `production` inputs cover `PLUGIN.md` and the pages, so a change to them invalidates the build; `production` leaves out test-like file names, which no file under `docs/` has.
- `nx-rust/README.md` says that the package carries `PLUGIN.md` and `docs/` under `node_modules/@convesoft/nx-rust/`.
- End-to-end test "has PLUGIN.md at the package root and the docs folder as it is": the package installed from the local registry has `PLUGIN.md` equal to the source and a `docs/` folder whose files equal those of `nx-rust/docs/`, whatever the pages are; only `index.mara.md` is named.
- `ADR-BUNDLED-DOCS` in `decisions.mara.md` records the maintainer's decision, why `PLUGIN.md` sits at the package root (from a reading of the installed `nx` 24.0.6 and `@nx/jest` 24.0.6) and its two consequences; `VER-SETUP` now also checks the package's root files and its `docs/` folder, and the two package tests cite the items.
- `.github/workflows/release.yml` checks the `npm pack --dry-run --json` listing (a list on npm 10 and 11, an object keyed by the package name on npm 12) for the required files, now including `PLUGIN.md` and every file under `nx-rust/docs/`, which the Node snippet lists itself so that a name with a blank stays whole, instead of only testing for files in `dist/nx-rust/`.
- After review, `PLUGIN.md` says that no per-crate Nx file is required while a crate's `project.json` or `package.json` and `targetDefaults` take part where a repository has them, states where the `fileInputs` example's manifest lies and that such patterns stay inside the repository (`runtimeInputs` for files outside), and narrows the cache-key summary, the verbose command, the detection sentence, the generator rows, the uncached targets, the unknown-key sentence and the nextest example to what the linked pages say.

Checks run: `pnpm nx build @convesoft/nx-rust` (output has `PLUGIN.md` and `docs/`, `diff -r` against `nx-rust/docs` is empty); `npm pack --dry-run` in `dist/nx-rust` lists `PLUGIN.md` and the 14 `docs/*.mara.md`; the release workflow's tarball step run locally passes for a complete package and for a page named with a blank, and fails with one docs page removed; `pnpm nx run-many -t build lint test` (8 tasks succeeded); `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (succeeded, and the new test passed in a filtered rerun); `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, evaluation complete); `zban check`; after the Mara items were added, the same checks and the end-to-end suite again. CI on the pull request covers the CI check.

## Decisions made

- `PLUGIN.md` sits at the package root (`node_modules/@convesoft/nx-rust/PLUGIN.md`), the path that Nx 24's agent rules name for `@nx/*` plugins, although `@nx/jest` 24.0.6 itself ships it under `dist/`.
- It follows the shape of `@nx/jest`'s `PLUGIN.md` (detection, commands, quick reference) and links into `docs/` with paths relative to the package root, which resolve both in the repository and in the package (`ADR-BUNDLED-DOCS`).
- The build copies the docs folder whole, with `**/*`, so that a new page ships without a change to the build (`ADR-BUNDLED-DOCS`).
- `ADR-BUNDLED-DOCS` accepts that the package grows by about 1.9 MB unpacked, of which `decisions.mara.md` is about 0.77 MB, some 40%.
- The packaging test compares the installed `docs/` with the source folder instead of listing pages.
- The decision is a new decision item, `ADR-BUNDLED-DOCS`, not an amendment of `ADR-PUBLISHING-AT-1-0`, which stays about when and how to publish. No requirement or design describes the package's contents, so it justifies none and names its basis with mentions.
- No verification item covered the package's contents; `VER-SETUP`, which already checks that `nx add` installs the package, gained the clause instead of a new item.
