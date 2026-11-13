---
title: Decide whether graph creation goes on for a path dependency whose own workspace cargo cannot load
status: todo
type: task
priority: low
discovered_from: nxr-m60y0c
created_at: 2026-11-13T18:12:22Z
---

Goal: the maintainer decides whether the remaining path dependencies that cargo builds but does not report also make graph creation go on with a warning, and how the plugin would tell them from a manifest that cargo rejects.

nxr-m60y0c made graph creation go on, as `DES-METADATA-REPORT` now says, only where cargo refuses a path dependency's report with "current package believes it's in a workspace when it's not". `EVD-CARGO-UNREPORTED-CRATES` records three more failures of such a report for a crate that `cargo check` of the using workspace builds: a crate in the folder of a workspace that lists a missing member ("failed to load manifest for workspace member"), and a crate whose `package.workspace` names a manifest without `[workspace]` ("root of a workspace inferred but wasn't a root") or a missing folder ("failed to read"). These still fail graph creation. The first message also comes when the member that fails to load is one that the crate depends on, which cargo then rejects in the using workspace as well, so the message alone cannot separate the two cases. All of them need the folder holding the crate to be ignored or excluded from Nx, because a workspace that Nx hands to the plugin fails graph creation on its own report first.

- [ ] Decide with the maintainer: keep these as errors, go on for the two unambiguous messages, or find another signal for the ambiguous one
- [ ] Record the decision in `DES-METADATA-REPORT` and `DES-DIAGNOSTICS`
- [ ] Implement it with a test, if anything changes

Done when: the decision is recorded and, if the behaviour changes, the parts of `VER-GRAPH` that cover it pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
