---
title: Decide how a non-host triple keeps features independent of the batch under workspace-build
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
related:
  - nxr-8f9dz2
discovered_from: nxr-f92hxm
created_at: 2026-11-14T16:03:27Z
closed_at: 2026-11-14T16:33:30Z
---

Goal: a group for a non-host target triple gives each crate a result that does not depend on its batch under the `workspace-build` strategy (`REQ-STABLE-FEATURES`), or the gap is accepted as a limit. This is a design decision for the maintainer, before nxr-8f9dz2 implements the non-host group.

Context: `DES-FEATURE-SETS` (`nx-rust/docs/execution.mara.md`) makes a non-host triple a group of its own that builds only the selected crates, because building the whole workspace for such a triple would include crates that cannot target it. Under `workspace-build` nothing else resolves features for the whole workspace there, so the features of third-party crates and of members follow the selection, as `-p a` against `-p a -p b` shows in `EVD-HAKARI-UNIFICATION`. The crates' keys hold every member's manifest and, after nxr-ms8zzk, every member's digest, but not the selection. Under `hakari`, a triple that `platforms` lists is unified for third-party crates, and the platforms check of `DES-UNIFICATION` makes a workspace that misses a known triple fall back to `workspace-build`, which leaves that triple's groups without unification at all. The flags gap of nxr-ytwfkc applies here as well.

Options to weigh, none decided: build every member that can target the triple, if the plugin can tell which; use the hack crate's per-platform unification where it exists; key such groups so that nothing is restored across selections; or accept the gap as a limit in a risk.

- [x] Agree with the maintainer how a non-host group resolves features under `workspace-build`, and what the platforms check of `hakari` does for a non-host triple
- [x] Record it in Mara: `DES-FEATURE-SETS`, `DES-UNIFICATION` where it applies, `VER-BATCHING`, and a risk if the gap is accepted
- [x] Bring nxr-8f9dz2 in line
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the decision is in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Decided by the control plane on 14 November 2026 under `GOAL-TRUSTED-CACHE` and `REQ-STABLE-FEATURES`, and recorded as such; the maintainer is told. It applies the rule of nxr-ytwfkc. Where a group cannot resolve features for the whole workspace, its crates get one cargo command each, so that features are resolved for that crate alone. That covers a non-host triple under `workspace-build`, and under `hakari` a triple or host that `platforms` does not list. No risk is added.

- `DES-FEATURE-SETS` runs a non-host triple under `workspace-build` one crate per command. It says that the keys of `workspace-build` (every member's manifest and digest and the crates outside the workspace) are a superset of what such a command depends on, which `DES-INPUTS` ("Whole-workspace builds") and `DES-BATCH` ("Groups of one crate") repeat. It also says why, under `hakari`, a triple that `platforms` lists may share a command: third-party features are unified per platform, member features are fixed by the first check, and flags are handled per crate.
- `DES-UNIFICATION` ("Triples when a task starts") now runs a task whose triple or host `platforms` does not list one crate per command. This replaces failing the task before cargo runs, which was accepted earlier in this branch; it is reported to the control plane. The error row in `DES-DIAGNOSTICS` is removed. The graph-time platforms check, the maintainer's own, is unchanged.
- `VER-BATCHING` has the "Triples" case; nxr-8f9dz2 and nxr-k64tm5 carry the work.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all` passed; `mara schema validate` passed; `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing. This is specification only, so no test run.
