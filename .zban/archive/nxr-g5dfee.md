---
title: Say in the status lines that the package is on npm when it is published
status: done
type: task
tags:
  - docs
parent: nxr-nm0jd6
discovered_from: nxr-2v14h1
created_at: 2026-11-14T11:04:52Z
closed_at: 2026-11-22T10:06:56Z
---

Goal: once `@convesoft/nx-rust` is published to npm, no page says that it is not. Whether and when it is published is decided at 1.0 (`ADR-PUBLISHING-AT-1-0`), so this issue waits for that decision.

nxr-2v14h1 made the status lines say that 0.1 is implemented on `main` and "not published to npm yet", and nxr-nz89fw made them say that `nx add` works once the package is published. `nx-rust/README.md` is packed into the package, so the version that npm shows has to say otherwise: change these lines in the change that publishes the package, before it is packed. If 1.0 decides not to publish, cancel this issue.

- [x] `README.md`: the status line, and the sentence above the commands under "What it looks like" that says `nx add` works only once the package is published
- [x] `nx-rust/README.md`: the status line, and the `# once the package is on npm` comment under "Usage"
- [x] The status notes of `nx-rust/docs/index.mara.md`, `product.mara.md` and `setup.mara.md`, and the project paragraph of `AGENTS.md`

Done when: `git grep -n -i "not published to npm"` finds none of these lines, and `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` pass.

## Summary of Changes

Updated the status lines and usage examples across `README.md`, `nx-rust/README.md`, `nx-rust/docs/index.mara.md`, `nx-rust/docs/product.mara.md`, `nx-rust/docs/setup.mara.md`, and `AGENTS.md` to reflect that 1.0 release candidates of `@convesoft/nx-rust` are published on npm under the `next` dist-tag (`nx add @convesoft/nx-rust@next`) ahead of real-repository validation for `1.0.0`.

- Checks run: `git grep -n -i "not published to npm" -- README.md nx-rust/ AGENTS.md` (zero matches), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check`, and CI on the pull request.
