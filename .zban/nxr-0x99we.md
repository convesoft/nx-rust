---
title: Run the Mara validation in CI
status: todo
type: task
tags:
  - infra
discovered_from: nxr-cxkn34
created_at: 2026-11-13T07:13:13Z
---

The workflow in `.github/workflows/ci.yml` does not run `mara schema validate` and `mara project validate`, so a pull request that breaks the knowledge base can turn green. The local run that `AGENTS.md` asks for is the only check.

Why it was left out: the knowledge base in `.mara/` needs Mara 0.4, and the newest published Mara is 0.3.0 (npm and GitHub Releases). Mara 0.3.0 rejects `.mara/project.toml` with `unknown project configuration key 'query_policy'`. The `mara 0.4.0-alpha.1` used locally is built from the branch `plan-execution-architecture` of the Mara repository. Building that commit from source in the workflow was considered; the user decided on 2026-11-13 to leave Mara out of CI for now.

- [ ] Confirm that a Mara version which validates this repository is published, and which one
- [ ] Install exactly that version in the `check` job
- [ ] Run `mara schema validate` and `mara project validate` after `pnpm install`: the project validation runs `scip-typescript` through pnpm (`.mara/project.toml`)
- [ ] Remove the note about Mara from `AGENTS.md` and the comment in the workflow

Done when: a pull request shows the two Mara commands green in the workflow.
