---
title: Settle whether the tasks of one Cargo workspace always share a toolchain
status: done
type: task
parent: nxr-w9qa5f
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T10:27:55Z
closed_at: 2026-11-13T15:21:32Z
---

Goal: the knowledge base says correctly which toolchain a crate's tasks use when a crate's own dotenv file chooses one.

Context: `EVD-NX-24-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`) shows that `RUSTUP_TOOLCHAIN` set in one crate's `.env` changes the toolchain in that crate's key only, while the other members of the same Cargo workspace keep theirs. Nx gives that environment to the task's runtime inputs and, unbatched, to the task's process. `DES-INVOCATION` (`caching.mara.md`), `ADR-WORKSPACE-ROOT` (`decisions.mara.md`) and `TERM-WORKSPACE-CONTEXT` (`product.mara.md`) describe the toolchain as a property of the whole workspace, which is stronger than this. Changing these accepted items needs the maintainer's agreement. The definition of a group (`TERM-GROUP`, `REQ-BATCHING`) is being settled separately (nxr-kq5pm5) and is not part of this issue.

- [x] Propose to the maintainer the wording of the three items, with the evidence
- [x] After agreement, update the items and any user guidance on the same pages that they contradict
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the agreed text is in the items, and `mara project validate` reports `valid: true`.

## Summary of Changes

The maintainer chose to describe what happens: a task's toolchain is whatever cargo picks in the workspace root with the task's environment, and a crate may choose another one through its dotenv file. There is no new code and no diagnostic. He agreed to the changes below to the accepted items.

- `DES-INVOCATION`: the same toolchain and configuration files apply to all tasks of a workspace. A task's environment can still choose another toolchain, such as `RUSTUP_TOOLCHAIN` in a crate's `.env`; the task then runs and is keyed with it and shares no cargo call with tasks whose environment differs.
- `ADR-WORKSPACE-ROOT`: the toolchain and configuration files found from the workspace root apply to every task, and a task's environment can override the toolchain file.
- `TERM-WORKSPACE-CONTEXT` and `ADR-MULTI-WORKSPACE`: "toolchain" became "toolchain file".
- `REQ-TOOLCHAIN-KEY`: the key holds the toolchain per task, with the task's environment, and the title now reads "Key each task on the toolchain it uses".
- `VER-CACHE-KEYS`: keys differ for a crate whose `.env` sets `RUSTUP_TOOLCHAIN`, and keys stay the same for the crates of its workspace that do not depend on it. `VER-BATCHING`: such a crate's task runs in a cargo call of its own with that toolchain.
- Guidance: the toolchain bullet on the caching page now covers a crate's `.env`, and the workspaces page says "toolchain file".

Research for the brief also found two points outside this issue, filed as nxr-9f2y12 (`RUSTC` and `CARGO_BUILD_RUSTC` bypass the toolchain input) and nxr-phcg8v (a dotenv file can move a task's artifact directory away from the declared outputs).

Checks run: `pnpm nx format:write`; `mara schema validate` (valid); `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings); `zban check` (no findings); `pnpm nx run-many -t build lint test` (4 tasks succeeded); `pnpm nx format:check --all` (clean). No code changed, so the end-to-end suite was not run.
