---
title: "1.0.0-rc.2: Findings from adopting nx-rust in mara"
status: done
type: epic
priority: high
tags:
  - milestone
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T16:52:01Z
---

Address the findings from adopting `@convesoft/nx-rust@1.0.0-rc.1` in `mara` (`nxr-pt464b`), and bundle `PLUGIN.md` and `nx-rust/docs/` in the published package so agents in adopting repositories can read version-matched docs from `node_modules/@convesoft/nx-rust/`.

Every child issue that changes specified behaviour updates the relevant Mara items (`DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-INPUTS`, `DES-OUTPUTS`, `DES-BATCH`, `DES-DIAGNOSTICS`, `DES-TEST-RUN`, `DES-TEST-MODE`, `RISK-HOST-ENVIRONMENT`, `EVD-CARGO-TARGET-COMMANDS`) in the same pull request before code changes land.

- [x] All child issues are closed
- [x] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [x] `mara schema validate`, `mara project validate` and `zban check` pass

Done when: all child issues are closed, all local checks and CI pass, and `main` is ready for the maintainer to publish `1.0.0-rc.2` under the `next` dist-tag.

## Summary of Changes

Six issues closed, each through its own pull request to `main`, reviewed and re-checked:

- nxr-gb7nbn (#88): guidance on per-target test inputs, test data outside `target/` and the cache shared between checkouts.
- nxr-tjxcvx (#89): `build.warnings = "deny"` and `CARGO_BUILD_WARNINGS=deny` are honoured in JSON compile steps; `REQ-BATCHING` amended by the maintainer.
- nxr-6rfafh (#87): `PLUGIN.md` and the docs folder ship in the npm package (`ADR-BUNDLED-DOCS`).
- nxr-rpcfg4 (#90): `lint` hashes the Clippy configuration that `CLIPPY_CONF_DIR` selects, also through Cargo's `[env]`; a warning for rustfmt configuration outside the repository.
- nxr-k5y74e (#91): a `test` option on the `test` target that runs one test target.
- nxr-w1qhmx (#92): the test steps name the crates and the setting where denied warnings stop them. Added to the milestone by the maintainer's decision of 22 November 2026.

Beside the milestone, nxr-9tcscc (#93) made CI run `pnpm zban check` from `@convesoft/zban@1.0.0-rc.1`.

Checks run at the tip of `main`, e858acf, on 22 November 2026, in the integration checkout: `pnpm install --frozen-lockfile`; `pnpm nx run-many -t build lint test` and `pnpm nx e2e nx-rust-e2e`, both with the Nx cache bypassed; `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, evaluation complete, no errors or warnings); `zban check` with zban 0.1.0 and `pnpm zban check` with 1.0.0-rc.1. All passed. CI on this pull request covers the two required checks on Cargo stable and Cargo 1.91.0.

The decisions made for the maintainer are in nxr-66an0w. The architecture audit after the milestone filed nxr-kjsfe6 (a bug in reading coloured cargo output outside the batch steps, not from this milestone) and backlog issues nxr-e4wynf, nxr-pydcgt, nxr-9qcd84, nxr-je2fns, nxr-tj16cn, nxr-88qk8s, nxr-p8hbp7 and nxr-ed68qx, and added notes to seven issues of the audit after 0.6. Publishing 1.0.0-rc.2 is the maintainer's.
