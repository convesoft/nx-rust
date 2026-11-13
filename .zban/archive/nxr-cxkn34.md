---
title: Set up CI and a pull request template for this repository
status: done
type: task
priority: critical
tags:
  - infra
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T07:14:44Z
---

`AGENTS.md` says pull requests are merged only once CI is green and describes what a pull request description holds, but the repository has no workflow and no template yet.

- [x] A GitHub Actions workflow that runs `pnpm exec nx run-many -t build lint test`, `pnpm format:check` and `zban check` on pull requests and on `main`. The Mara validation is left out for now and follows in nxr-0x99we (decided by the user on 2026-11-13)
- [x] The end-to-end suite (`pnpm exec nx e2e nx-rust-e2e`) in the workflow, with a Rust toolchain installed
- [x] Linux runners only: macOS runs are deferred (`ADR-CI-LINUX-ONLY`, nxr-wfzc23)
- [x] `.github/pull_request_template.md` with the sections `AGENTS.md` describes (what and why, checks run, known limitations, `Refs:` footer)
- [x] `AGENTS.md` points at the template

Done when: a pull request shows the workflow green, and the template appears when a pull request is opened.

## Summary of Changes

- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`, on Linux only (`ADR-CI-LINUX-ONLY`). The job `check` runs `pnpm exec nx run-many -t build lint test`, `pnpm format:check` and `zban check`, with zban 0.1.0 taken from its release and verified by checksum. The job `e2e` installs the stable Rust toolchain and runs `pnpm exec nx e2e nx-rust-e2e`.
- The Mara validation is not in the workflow: the knowledge base needs Mara 0.4, which is not published. The user decided on 2026-11-13 to leave it out for now. nxr-0x99we brings it in, and `AGENTS.md` says that the local run is the only check until then.
- The pull request template and the pointer to it in `AGENTS.md` reached `main` in commit 009dd82.
- Found on the way: the end-to-end suite fails when a coding agent runs it (nxr-qvgptg). It passes in the environment CI has.

Checks run: the steps of the workflow locally (`pnpm install --frozen-lockfile`, build, lint and test with `--skip-nx-cache`, `pnpm format:check`, the zban download with its checksum, `zban check`, and the end-to-end suite with `CI=true` and the agent variables unset); actionlint with shellcheck on the workflow; `mara schema validate` and `mara project validate`. GitHub lists the template for the repository (GraphQL `pullRequestTemplates`). CI on this issue's pull request covers the one check that is left, the workflow being green.
