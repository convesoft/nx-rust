---
title: Decide whether the lockfile step of nx release version creates a Cargo.lock where a workspace has none
status: done
type: task
parent: nxr-6q2chq
discovered_from: nxr-n6z9x6
created_at: 2026-11-14T21:18:22Z
closed_at: 2026-11-14T22:31:39Z
---

Needs the maintainer's decision; nothing is to be implemented before it.

`cargo update --workspace` in a workspace without a `Cargo.lock` writes one (`EVD-CARGO-LOCKFILE-UPDATE`), as every resolving cargo command does. Run as `DES-RELEASE` (**Lockfile**) first read, the step would therefore create a lockfile in a changed workspace that has none, and Nx would commit it with the release where git does not ignore it. nxr-n6z9x6 implemented the conservative reading instead: the step leaves such a workspace without a lockfile and runs nothing there, and `DES-RELEASE` records it as pending this decision.

- [x] The maintainer chooses: keep creating none, or let the step create the lockfile (and commit it where git does not ignore it), as plain `cargo update` would (decided by the control plane on 14 November 2026, the maintainer told: keep creating none)
- [x] `DES-RELEASE` is rewritten to the answer, and a follow-up issue is filed if it asks for code (no code needed: the step already creates none)

## Summary of Changes

- The control plane decided on 14 November 2026, and told the maintainer: the step creates no `Cargo.lock` where a workspace has none, "the step exists to keep an existing lockfile current, and where none exists nothing can be stale; a user who wants a lockfile runs cargo once". Rejected: creating the lockfile as plain `cargo update` would.
- `DES-RELEASE` ("Lockfile") now records this decision in place of "pending", with the rejected option; the release guide says that a workspace without a `Cargo.lock` gets none. No code changed: nxr-n6z9x6 already creates none, and group 4 of `VER-RELEASE` checks it ("creates no lockfile where a workspace has none").
- Closed in the nxr-n6z9x6 branch. Checks: `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `zban check`, and the release specs, which include the no-lockfile case (see nxr-n6z9x6).
