---
title: Update the status lines of the two READMEs
status: done
type: task
priority: low
tags:
  - docs
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:35Z
closed_at: 2026-11-14T11:05:07Z
---

Goal: the root `README.md` and `nx-rust/README.md`, which npm shows, say what the plugin does today.

Both still open with "the design is specified and the implementation has not started", while discovery (nxr-7n0nqf) and project creation (nxr-1bv0wm) work. `nx-rust/docs/workspaces.mara.md` has its own status note, kept current by the issues that change it.

- [x] Decide with the user what the status lines say before the first release, or whether they stay until it
- [x] Update both

Done when: both READMEs agree with the docs, and `pnpm nx format:check --all` passes.

## Summary of Changes

Decision of the maintainer, 14 November 2026, the option chosen word for word: "Update now: implemented, unpublished (Recommended)": both READMEs and the status notes on the docs pages say what works on `main` today and that 0.1 is not yet on npm.

- `README.md` and `nx-rust/README.md`: the status line says that milestone 0.1 (crates of Cargo workspaces as Nx projects, the dependency graph, inferred targets, caching of task results) is implemented on `main` and not published to npm yet, and names milestones 0.2 to 0.5. The feature lists mark batching as milestone 0.2 and napi and wasm artifacts as 0.4. Each `nx add` command says that it works only once 0.1 is on npm. "What it will look like" is now "What it looks like". The list of docs pages in the root README already matched `nx-rust/docs/index.mara.md`.
- Status notes, each checked against the code and tests on `main`. Every sentence about work that is done is gone, and what is not implemented is named with its milestone:
  - `index` and `product` say that 0.1 is implemented and not published.
  - `setup` says the package is not on npm and that tasks run only cargo-audit and cargo-deny so far, with `init` counting no other tool as needed.
  - `targets` names `napi-build`, `wasm-build`, the coverage baseline, the release targets, nextest and batching. The stale sentence that `audit` and `deny` fail with cargo's own message is gone: they fail before cargo runs (`test/missing-tools.spec.ts`).
  - `configuration` names the four settings without effect and `NX_RUST_TEST_MODE`.
  - `caching` names only the `hakari` and `cargo` strategies.
  - `ci` names only the coverage baseline.
  - `testing` was stale: it said `testRunner` and `affectedTests` are not read. It now says what is read and checked, and what arrives with 0.3.
  - `workspaces` has no note left. Three sentences of its guidance that described later features as present now name their milestones instead: the coverage baseline (0.3) among the workspace-level tasks, and the batches (0.2) and the coverage baseline (0.3) among what stays per workspace. The sentence about the `lockfile` task now excludes `fmt-check`, which does not wait for it (`nx-rust/src/graph/caching.ts`, `nx-rust/test/targets.spec.ts`).
- `AGENTS.md`: the project paragraph no longer says that the implementation has not started.
- Follow-up nxr-g5dfee: say that 0.1 is on npm in these lines in the change that publishes it.

Checks run: `pnpm nx format:write`, then `pnpm nx format:check --all` passed. `mara schema validate` and `mara project validate` passed (`valid: true`, evaluation complete, 0 errors, 0 warnings), and so did `zban check`. No unit or e2e run: a text change only, and the e2e test that compares the packed README with `nx-rust/README.md` does not depend on its text.
