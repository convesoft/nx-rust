---
title: Decide whether graph creation goes on for a path dependency whose own workspace cargo cannot load
status: done
type: task
priority: low
discovered_from: nxr-m60y0c
created_at: 2026-11-13T18:12:22Z
closed_at: 2026-11-14T11:22:26Z
---

Goal: the maintainer decides whether the remaining path dependencies that cargo builds but does not report also make graph creation go on with a warning, and how the plugin would tell them from a manifest that cargo rejects.

nxr-m60y0c made graph creation go on, as `DES-METADATA-REPORT` now says, only where cargo refuses a path dependency's report with "current package believes it's in a workspace when it's not". `EVD-CARGO-UNREPORTED-CRATES` records three more failures of such a report for a crate that `cargo check` of the using workspace builds: a crate in the folder of a workspace that lists a missing member ("failed to load manifest for workspace member"), and a crate whose `package.workspace` names a manifest without `[workspace]` ("root of a workspace inferred but wasn't a root") or a missing folder ("failed to read"). These still fail graph creation. The first message also comes when the member that fails to load is one that the crate depends on, which cargo then rejects in the using workspace as well, so the message alone cannot separate the two cases. All of them need the folder holding the crate to be ignored or excluded from Nx, because a workspace that Nx hands to the plugin fails graph creation on its own report first.

- [x] Decide with the maintainer: keep these as errors, go on for the two unambiguous messages, or find another signal for the ambiguous one
- [x] Record the decision in `DES-METADATA-REPORT` and `DES-DIAGNOSTICS`
- [x] Implement it with a test, if anything changes

Done when: the decision is recorded and, if the behaviour changes, the parts of `VER-GRAPH` that cover it pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The maintainer's answer of 13 November 2026, word for word the option he chose: "Warn for two, keep one an error (Recommended)". Graph creation now goes on with the warning that a path dependency without a project already got for "current package believes it's in a workspace when it's not" also where cargo refuses the crate's report with "root of a workspace inferred but wasn't a root" (its `package.workspace`, or that of a crate above it, names a manifest without `[workspace]`) or with "failed to read" for a manifest other than the crate's own (as where `package.workspace` names a missing folder). "failed to load manifest for workspace member" stays an error.

- `nx-rust/src/graph/discovery.ts`: `isUnreportedPathDependency` replaces `isUnreportedNonMember`. It takes the two new messages only as cargo's error itself, the first `error:` line, because cargo prints both also as the cause of a manifest it rejects (a crate that takes a key from such a workspace), where the using workspace's build fails too; and "failed to read" only for another manifest than the crate's own, which cargo also cannot read when the crate itself is unreadable.
- Reproduced each message with cargo 1.100.0 and 1.91.0 (same wording) and recorded them, with the nested and unreadable cases, in `EVD-CARGO-UNREPORTED-CRATES`. Updated `DES-METADATA-REPORT` (with the maintainer's reason for the error), the `DES-DIAGNOSTICS` row, `VER-GRAPH`, `VER-SETUP` and the guidance in `workspaces.mara.md`.
- Tests: `discovery.spec.ts` checks that graph creation goes on for both new reasons with the default cargo and 1.91.0, the warning carrying cargo's message and the two sentences about what is not followed and what to do; that it fails for a workspace listing a missing member, for both messages given only as the cause, and for the crate's own unreadable manifest. A run against the old matcher failed the four new going-on cases, and a run with a substring match failed the four error cases. `warnings.spec.ts` checks that the warning goes the route of pull request #67: `server:fmt-check` and `server:build` change key through `server:ProjectConfiguration` alone, and the task prints the warning whether it runs or is restored.

Checks run: `pnpm nx run-many -t build lint test` (36 suites, 1217 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics) and `zban check`.
