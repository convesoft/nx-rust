---
title: Set up CI and a pull request template for this repository
status: todo
type: task
priority: critical
tags:
  - infra
created_at: 2026-11-12T18:20:01Z
---

`AGENTS.md` says pull requests are merged only once CI is green and describes what a pull request description holds, but the repository has no workflow and no template yet.

- [ ] A GitHub Actions workflow that runs `pnpm exec nx run-many -t build lint test`, `pnpm format:check`, `mara schema validate`, `mara project validate` and `zban check` on pull requests and on `main`
- [ ] The end-to-end suite (`pnpm exec nx e2e nx-rust-e2e`) in the workflow, with a Rust toolchain installed
- [ ] Linux runners only: macOS runs are deferred (`ADR-CI-LINUX-ONLY`, nxr-wfzc23)
- [x] `.github/pull_request_template.md` with the sections `AGENTS.md` describes (what and why, checks run, known limitations, `Refs:` footer)
- [x] `AGENTS.md` points at the template

Done when: a pull request shows the workflow green, and the template appears when a pull request is opened.
