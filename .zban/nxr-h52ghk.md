---
title: "1.0.0-rc.2: Findings from adopting nx-rust in mara"
status: todo
type: epic
priority: high
tags:
  - milestone
created_at: 2026-11-22T10:39:28Z
---

Address the findings from adopting `@convesoft/nx-rust@1.0.0-rc.1` in `mara` (`nxr-pt464b`), and bundle `PLUGIN.md` and `nx-rust/docs/` in the published package so agents in adopting repositories can read version-matched docs from `node_modules/@convesoft/nx-rust/`.

Every child issue that changes specified behaviour updates the relevant Mara items (`DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-INPUTS`, `DES-OUTPUTS`, `DES-BATCH`, `DES-DIAGNOSTICS`, `DES-TEST-RUN`, `DES-TEST-MODE`, `RISK-HOST-ENVIRONMENT`, `EVD-CARGO-TARGET-COMMANDS`) in the same pull request before code changes land.

- [ ] All child issues are closed
- [ ] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [ ] `mara schema validate`, `mara project validate` and `zban check` pass

Done when: all child issues are closed, all local checks and CI pass, and `main` is ready for the maintainer to publish `1.0.0-rc.2` under the `next` dist-tag.
