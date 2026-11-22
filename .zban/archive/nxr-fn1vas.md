---
title: Review every risk before 1.0
status: done
type: task
parent: nxr-nm0jd6
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-22T09:13:07Z
---

Goal: no risk in `nx-rust/docs/decisions.mara.md` still says "To check", "To measure" or "To track" without an evidence item behind it.

- [x] For each risk: the spike is closed and its evidence item is linked, or the risk is explicitly accepted by a decision
- [x] Likelihood and consequence reflect what the spikes found
- [x] Risks that no longer apply are retired

Done when: the review is recorded in this issue's summary, and `mara project validate` reports `valid: true`.

## Summary of Changes

Audited all 22 `RISK-` items in `nx-rust/docs/decisions.mara.md` before 1.0:

- Verified that none of the 22 risks is obsolete (each still reflects an active residual uncertainty in v1, so none was retired) and that likelihood and consequence ratings match the completed spikes and evidence.
- Linked previously unlinked incoming Mara relations so every risk has linked evidence, mitigation, or an explicit accepting decision:
  - `ADR-COMPATIBILITY` `:accepts:` `RISK-UPSTREAM-CHANGES`
  - `ADR-CI-LINUX-ONLY` `:accepts:` `RISK-TERMINAL-ENVIRONMENT-MACOS`
  - `EVD-NX-24-PLUGIN-NODES` `:supports:` `RISK-GUARD-HASH-PLAN`
  - `EVD-CARGO-PUBLISH` `:supports:` `RISK-UNCOMMITTED-PUBLISH`
  - `EVD-NX-24-BATCHES` `:supports:` `RISK-TERMINAL-ENVIRONMENT-MACOS`
  - `DES-BASELINE` (`nx-rust/docs/ci.mara.md`) `:mitigates:` `RISK-BASELINE-DRIFT`
- Verified `RISK-NAPI-TOOLING`'s remaining unchecked question locally on a throwaway copy of `nx-rust/test/fixtures/napi-addons` (Linux x86-64, cargo 1.100.0, `napi` 3.16.2, `napi-sys` 3.4.1): plain `cargo test --workspace` and `cargo test -p addon-a` (with a `#[test]` calling a `#[napi]` function) compile, link, and execute with no special feature because `napi-sys` enables `dyn-symbols` by default via `libloading`. Recorded this in `EVD-NAPI-POSTPROCESS` and updated `RISK-NAPI-TOOLING`.
- Removed the stale pre-1.0 "To measure" / "To track" / "to check" wording from the `## Risks` intro, `RISK-BASELINE-DRIFT`, `RISK-UPSTREAM-CHANGES`, and `RISK-MIXED-PROJECT-MERGE`, and noted that `RISK-GUARD-HASH-PLAN`'s `nxr-2vzmt5` mitigation was deferred to the backlog on 15 November 2026.
- Checks run: `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check`, and CI on the pull request.
