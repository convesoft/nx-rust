---
title: Simplify dotenv-check.ts without re-implementing dotenv-expand 12.0.3
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
  - nxr-4sr6hd
related:
  - nxr-5rrkay
created_at: 2026-11-20T10:24:42Z
closed_at: 2026-11-20T18:14:04Z
---

Goal: replace the 836-line symbolic `dotenv-expand` 12.0.3 simulator in `nx-rust/src/executors/dotenv-check.ts` with a simpler, version-independent check that preserves `GOAL-TRUSTED-CACHE` and `DES-BATCH`.

Context: `dotenv-check.ts` currently re-implements `dotenv-expand` 12.0.3 step-by-step with a 1,000,000-step state-space search, Brent's cycle detection, region tracking, SHA-1 state digests, and Unicode PUA placeholders, and hard-fails whenever Nx upgrades `dotenv-expand` away from exact version `12.0.3` (`RISK-UPSTREAM-CHANGES`, `DES-BATCH`, `VER-BATCHING`).

- [x] Evaluate replacing the simulator with either a conservative static `$VAR`/`${VAR...}` dependency-graph check over raw dotenv definitions or a `Proxy`-trapped execution of the installed Nx's own `dotenv-expand`
- [x] Update `DES-BATCH` ("Dotenv files") and `VER-BATCHING` in Mara if the accepted contract for `.env` expansion checks changes, and confirm with the maintainer if any edge-case acceptance narrows
- [x] Implement the simplified check and remove the exact `12.0.3` version pin
- [x] Keep existing dotenv-check and dotenv-equivalence tests passing and add coverage for the simplified behaviour

Done when: `dotenv-check.ts` no longer re-implements `dotenv-expand` or pins `12.0.3`, Mara validation passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.


## Summary of Changes

- Replaced the 848-line step-by-step `dotenv-expand` 12.0.3 follower (`expansionLookup`, `expandLikeNx`, Brent cycle detector, region tracker, PUA placeholders, simulator bounds, and exact `12.0.3` version pin) in `nx-rust/src/executors/dotenv-check.ts` with a 455-line version-independent static reference check over `$VAR`, `${VAR...}` and `$$VAR` forms (cycles allowed via a visited set keyed by `(variable, followedByIdent)`), while keeping the vault check, `NX_LOAD_DOT_ENV_FILES` check, and exported caller signatures (`dotenvProblem`, `dotenvDefinitions`, `readTaskDotenv`) unchanged.
- Shared `rootDotenvFiles` from `nx-rust/src/executors/task-env.ts` in `nx-rust/src/executors/dotenv-check.ts`.
- Updated `DES-BATCH` ("Dotenv files"), `DES-DIAGNOSTICS`, `VER-BATCHING`, and `RISK-UPSTREAM-CHANGES`, and added `EVD-DOTENV-STATIC-CHECK` in `nx-rust/docs/decisions.mara.md`.
- Updated `nx-rust/test/dotenv-check.spec.ts` (self-append idioms, newly refused forms, audit corrections for substituted default/alternative bodies and even-backslash `$` escapes, and updated expectations) and `nx-rust/test/dotenv-equivalence.spec.ts` (acyclic topological generator plus leaf `RUSTFLAGS` self-append so all 2,500 default seeds run through Nx's real loader with 0 skips and 0 mismatches: 708 passed, 1,792 refused).
- Filed backlog issue `nxr-vwpjg2` for `batch.ts` running `taskDotenvLayer` before `dotenvProblem`.
- Merged `main` at `1a9a03b05b593c4707a834349fbb17642963d744` and ran all checks after the merge: `pnpm nx format:write`, `pnpm nx run-many -t build lint test` (8/8 passed), `pnpm nx e2e nx-rust-e2e` (27/27 passed), CI-env run of `dotenv-check`, `dotenv-equivalence`, `task-dotenv-layer` and `nx-bridge` (4 suites, 60/60 passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, and `zban check`.

## Decisions made

- Maintainer decision (20 November 2026, recorded in `DES-BATCH`): chose `"Static, cycles allowed (Recommended)"` over the same static check with cycles refused and over keeping the `dotenv-expand` 12.0.3 follower.
- Audit corrections included in `DES-BATCH` and `dotenv-check.ts`: default/alternative bodies are scanned as substituted text so trailing unbraced references cannot join adjacent identifier characters (`VALUE=${A:-$FORCE_}COLOR`, `PASSWORD=pa$$FORCE_` with `USE=${PASSWORD}COLOR`), and `$` after an even number of backslashes (`\\$FORCE_COLOR`) counts as unescaped so the check does not rely on one `dotenv-expand` version's backslash handling.


### Review fix round (after 296f4e6)

- Fixed `$$NAME` indirection (`SELECTED=FORCE_COLOR` + `VALUE=$$SELECTED`, command-set `SELECTED=NX_FORKED_TASK_EXECUTOR`, multiline quoted CRLF, `SELECTED={FORCE_COLOR}`, `$$$A`): `checkDoubleDollarTarget` inspects every candidate value of `NAME` (in files, in `env`, or empty) and follows any single identifier that `$<value>` starts while refusing dynamic assembly.
- Restored acceptance for `PASSWORD=pa$$word` with `VALUE=${PASSWORD}` (tracking `followedByRefStart` separately from `followedByIdent` so trailing `$`/`$$` in substituted values is refused only where `[A-Za-z_{$]` follows, while `USE=${PASSWORD}COLOR` stays refused), non-identifier literal braced names (`${APP.VERSION}`, `${1}`), unknown POSIX operators (`${SET:?error}`, while splitting `:?`/`?`/`:=`/`=` keys so `${FORCE_COLOR:?missing}` is refused), and non-special `$!` / `$$!` values.
- Removed all value substrings from diagnostics: every ambiguous-form message now names only the file, the variable being expanded, an optional static referenced variable name, and the kind of form in words, never any character from a file or environment value (verified by a secret-marker test across every refusal kind).
- Updated `dotenv-equivalence.spec.ts` to include variable-name literals and explicit `$$HOST`/`$$CMD` indirection (690 passed, 1,810 refused, 0 skipped, 0 mismatches across 2,500 seeds) plus fixed equivalence cases for terminating multi-variable cycles (`A=${B}` with `B=${A}`, `A=${B}\nB=${A}\nVALUE=x${A}` under `A=shell`), `cycle with unsafe branch`, `$$NAME` indirection, and `PASSWORD=pa$$word` with `VALUE=${PASSWORD}`.

### Second review fix round (after 8b488d0)

- Aligned `dotenv-check.ts` exactly with the installed `dotenv-expand` (`lib/main.js`) matching, splitting (`split(null)` on `"null"` catching `${NX_FORKED_TASK_EXECUTORnull}` and `${Anull$FORCE_COLOR}`, without splitting unknown POSIX operators like `${SET:?error}`), escaping (`(?<!\\)` letting `\\$FORCE_COLOR` pass), and `String.prototype.replace` behaviour (propagating `afterEscapedDollar` so `\$NAMEEXECUTOR $NAME`, `\$AEXECUTOR ${B}`, `\${A}COLOR ${A}`, and `\${A}COLOR ${B}` with `B="p${A} "` are refused, refusing `\$&`/`\$'`/`` \$` `` in substituted values, and letting top-level `${UNCLOSED` without a following reference and `${}` pass while refusing `${FORCE_${PART}`).
- Added a source-text tripwire test on Nx's installed `dotenv-expand` `lib/main.js` in `nx-rust/test/dotenv-check.spec.ts` and removed unused `readNxDependencyVersion` from `nx-rust/src/compatibility/nx-bridge.ts` and `nx-rust/test/nx-bridge.spec.ts`.
- Tightened `via` provenance in `dotenv-check.ts` so only clean identifiers written directly in the task's dotenv files (never keys parsed from ambient/substituted values such as via `${1}`) can appear in diagnostics; extended the secret-marker test in `dotenv-check.spec.ts` to cover `${1}` paths.
- Updated `nxr-vwpjg2` and `DES-BATCH` / `EVD-DOTENV-STATIC-CHECK` with the verified batch-only runaway example (`B=x$B` with `VALUE=${NX_FORKED_TASK_EXECUTOR:+$B z}`), updated the executor user guide table in `nx-rust/docs/execution.mara.md`, split `DES-DIAGNOSTICS` in `nx-rust/docs/setup.mara.md` into separate vault / static-ambiguity / missing-Nx-part rows, updated `RISK-UPSTREAM-CHANGES`, `EVD-NX-24-BATCHES`, and `VER-BATCHING`, and asserted exact default-seed counts (716 passed, 1,784 refused, 0 skipped, 0 mismatches) plus Point 1 & Point 2 fixed cases in `nx-rust/test/dotenv-equivalence.spec.ts`.
