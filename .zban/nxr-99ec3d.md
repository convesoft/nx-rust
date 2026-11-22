---
title: Record the decision to ship PLUGIN.md and the docs folder in the npm package in Mara
status: todo
type: task
parent: nxr-h52ghk
discovered_from: nxr-6rfafh
created_at: 2026-11-22T11:40:04Z
---

Cites: `ADR-PUBLISHING-AT-1-0`, `REQ-COMPATIBILITY`.

nxr-6rfafh made the published `@convesoft/nx-rust` package carry `PLUGIN.md` and every file of `nx-rust/docs/` as it is, by the maintainer's decision of 22 November 2026 (quoted in nxr-6rfafh). That issue was told not to change any file in `nx-rust/docs/`, so the decision is not in Mara yet, although AGENTS.md wants product decisions there and the package contents are user-visible.

- [ ] Record the decision as a decision item in `decisions.mara.md` (or as an amendment of `ADR-PUBLISHING-AT-1-0`), including that the docs ship as they are, so relative links that leave `docs/` (the `.zban/` link in `index.mara.md` and `product.mara.md`) do not resolve inside the package, and that the package grows by about 1.9 MB unpacked
- [ ] Add a verification item for the package contents, or extend an existing one, and point it at the end-to-end test "has PLUGIN.md at the package root and the docs folder as it is" and the tarball check in `.github/workflows/release.yml`
- [ ] Link `nx-rust/PLUGIN.md` from the item where useful, and mention `PLUGIN.md` in the setup page's user guidance if the maintainer wants it there

Done when: the items are accepted with what the policies require, and `mara schema validate`, `mara project validate`, `pnpm nx format:check --all` and `zban check` pass.
