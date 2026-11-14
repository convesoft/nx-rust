---
title: Say in the status lines that 0.1 is on npm when it is published
status: todo
type: task
tags:
  - docs
related:
  - nxr-w9qa5f
discovered_from: nxr-2v14h1
created_at: 2026-11-14T11:04:52Z
---

Goal: once milestone 0.1 is published to npm, no page says that it is not.

nxr-2v14h1 made the status lines say that 0.1 is implemented on `main` and "not published to npm yet". `nx-rust/README.md` is packed into the package, so the version that npm shows has to say otherwise: change these lines in the change that publishes 0.1, before the package is packed.

- [ ] `README.md`: the status line, and the sentence above the commands under "What it looks like" that says `nx add` works only once 0.1 is published
- [ ] `nx-rust/README.md`: the status line, and the `# once 0.1 is on npm` comment under "Usage"
- [ ] The status notes of `nx-rust/docs/index.mara.md`, `product.mara.md` and `setup.mara.md`, and the project paragraph of `AGENTS.md`

Done when: `git grep -n -i "not published to npm"` finds none of these lines, and `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` pass.
