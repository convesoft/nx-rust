---
title: Add PLUGIN.md and bundle nx-rust/docs in the published npm package
status: todo
type: task
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
---

Cites: `ADR-PUBLISHING-AT-1-0`, `DES-PLUGIN-OPTIONS`, `DES-TARGETS`, `DES-INPUTS`.

Maintainer decision (22 Nov 2026): add `PLUGIN.md` and bundle all files in `nx-rust/docs/` as-is in the published `@convesoft/nx-rust` npm package so AI agents and developers in adopting repositories can read version-matched documentation directly through `node_modules/@convesoft/nx-rust/`.

- [ ] Add a concise, agent-friendly `nx-rust/PLUGIN.md` (following Nx 24's `PLUGIN.md` convention for plugins) summarizing common commands, `Cargo.toml` metadata overrides, caching rules, and pointing to the bundled `docs/` folder
- [ ] Update `nx-rust/project.json` build `assets` to copy `PLUGIN.md` (already matched by `*.md`, confirm) and all of `nx-rust/docs/` into `dist/nx-rust/docs/` without modifying the docs themselves
- [ ] Update `nx-rust/README.md` to mention `PLUGIN.md` and the bundled `docs/` alongside the GitHub documentation link
- [ ] Add a packaging test (or check in existing build/e2e tests) verifying `PLUGIN.md` and `docs/*.mara.md` are present in `dist/nx-rust/` and the published tarball (`npm pack --dry-run`)

Done when: `pnpm nx build @convesoft/nx-rust` outputs `dist/nx-rust/PLUGIN.md` and all `dist/nx-rust/docs/*.mara.md`, `npm pack --dry-run` includes them, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.
