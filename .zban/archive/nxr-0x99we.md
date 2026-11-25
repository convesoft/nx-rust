---
title: Run the Mara validation in CI
status: done
type: task
tags:
  - infra
discovered_from: nxr-cxkn34
created_at: 2026-11-13T07:13:13Z
closed_at: 2026-11-25T10:17:10Z
---

The workflow in `.github/workflows/ci.yml` does not run `mara schema validate` and `mara project validate`, so a pull request that breaks the knowledge base can turn green. The local run that `AGENTS.md` asks for is the only check.

Why it was left out: the knowledge base in `.mara/` needs Mara 0.4, and the newest published Mara is 0.3.0 (npm and GitHub Releases). Mara 0.3.0 rejects `.mara/project.toml` with `unknown project configuration key 'query_policy'`. The `mara 0.4.0-alpha.1` used locally is built from the branch `plan-execution-architecture` of the Mara repository. Building that commit from source in the workflow was considered; the user decided on 2026-11-13 to leave Mara out of CI for now.

- [x] Confirm that a Mara version which validates this repository is published, and which one (`@convesoft/mara@0.4.0-rc.1`)
- [x] Install exactly that version in the `check` job (pinned as a root `devDependency` and installed by `pnpm install --frozen-lockfile`)
- [x] Run `pnpm mara --no-daemon schema validate` and `pnpm mara --no-daemon project validate` after `pnpm install` (Mara 0.4.0-rc.1 scans TypeScript comment markers directly instead of SCIP, so `@sourcegraph/scip-typescript` and `.mara/code/scip-index-cache.cjs` were removed)
- [x] Remove the note about Mara from `AGENTS.md` and the comment in the workflow

Done when: a pull request shows the two Mara commands green in the workflow.

## Summary of Changes

- Added `@convesoft/mara` pinned to exact `0.4.0-rc.1` as a root `devDependency` in `package.json`, and removed `@sourcegraph/scip-typescript` (no longer needed under Mara 0.4.0's comment-marker code links).
- Migrated the repository from Mara 0.3.0 (`:::mara` blocks, `.mara/project.toml`, `.mara/schema.yaml`, YAML rules) to Mara 0.4.0-rc.1 using `pnpm mara --no-daemon project convert`, tightened `[relations.satisfies]` in `.mara/schema.toml`, added the 0.4.0-rc.1 engineering template Datalog rules under `.mara/rules/{knowledge,readiness,risk-matrix}.dl` with their `[rules]`, `[queries.*]`, `[views.*]`, `[invariants.*]`, and `[gates.*]` entries in `.mara/config.toml`, configured basic-level `[code.languages.typescript]` marker scanning, and removed the legacy 0.3.0 `.mara/` files (`.mara/project.toml`, `.mara/schema.yaml`, `.mara/engineering-*`, `.mara/code/`, `.mara/conversion-report.json`) and obsolete `.gitignore` entries.
- Updated `.github/workflows/ci.yml` (`build-lint-format` job) to run `pnpm mara --no-daemon schema validate` and `pnpm mara --no-daemon project validate` after `pnpm zban check`.
- Updated `AGENTS.md`, `README.md`, `.github/pull_request_template.md`, `nx-rust/docs/index.mara.md`, and `nx-rust/PLUGIN.md` for Mara 0.4.0-rc.1 and removed the note about Mara being absent from CI.

Checks run locally:
- `pnpm install --frozen-lockfile`
- `pnpm mara --no-daemon schema validate` (0 errors, 0 warnings)
- `pnpm mara --no-daemon project validate` (0 errors, 0 warnings)
- `pnpm mara --no-daemon query execute implemented --id DES-DISCOVERY` (verified TypeScript code markers resolve)
- `pnpm nx format:check --all`
- `pnpm nx run-many -t build lint`
- `pnpm zban check`

CI on the pull request covers the `Done when` check (the two Mara commands passing in `.github/workflows/ci.yml`) as well as the full unit and end-to-end suites.
