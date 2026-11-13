---
title: Settle whether the tasks of one Cargo workspace always share a toolchain
status: todo
type: task
parent: nxr-w9qa5f
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T10:27:55Z
---

Goal: the knowledge base says correctly which toolchain a crate's tasks use when a crate's own dotenv file chooses one.

Context: `EVD-NX-24-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`) shows that `RUSTUP_TOOLCHAIN` set in one crate's `.env` changes the toolchain in that crate's key only, while the other members of the same Cargo workspace keep theirs. Nx gives that environment to the task's runtime inputs and, unbatched, to the task's process. `DES-INVOCATION` (`caching.mara.md`), `ADR-WORKSPACE-ROOT` (`decisions.mara.md`) and `TERM-WORKSPACE-CONTEXT` (`product.mara.md`) describe the toolchain as a property of the whole workspace, which is stronger than this. Changing these accepted items needs the maintainer's agreement. The definition of a group (`TERM-GROUP`, `REQ-BATCHING`) is being settled separately (nxr-kq5pm5) and is not part of this issue.

- [ ] Propose to the maintainer the wording of the three items, with the evidence
- [ ] After agreement, update the items and any user guidance on the same pages that they contradict
- [ ] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the agreed text is in the items, and `mara project validate` reports `valid: true`.
