---
title: Remove 0.6 provisional marks and document staged-build limits in the guide
status: in-progress
type: task
tags:
  - docs
related:
  - nxr-vk19v5
discovered_from: nxr-vk19v5
created_at: 2026-11-21T20:37:40Z
---

Goal: confirm the two user-visible provisional decisions of milestone 0.6 (`nxr-vk19v5` lines 22 and 25) that the maintainer approved on 21 November 2026, remove the remaining provisional marks, and document both limits in the user-facing guide.

Context:
- `nxr-vk19v5` line 22 (`--nx-bail` under staged builds): confirmed to stand as a documented Nx 24 limitation. Remove the provisional wording in `ADR-STAGED-BUILDS` (`nx-rust/docs/decisions.mara.md`) and `DES-BATCH` (`nx-rust/docs/execution.mara.md`), recording that the maintainer confirmed it on 21 November 2026.
- `nxr-vk19v5` line 25 (warm-cache limit on same-folder `build` refusal): confirmed to stand for v1, and the maintainer asked to make sure it is documented for users. `DES-BATCH` already states the limit; add clear user-facing coverage of both this limit (two `build` tasks of one crate into one folder are refused whenever at least one runs uncached, while if Nx restores both from a warm cache no executor runs and neither is refused, leaving the last-restored files on disk with both cache entries valid) and the `--nx-bail` batch behaviour in the user-facing guide of `nx-rust/docs/execution.mara.md` (and any other relevant guide section, keeping guidance concise and consistent with the normative items).

- [ ] Remove the provisional marks in `ADR-STAGED-BUILDS` (`nx-rust/docs/decisions.mara.md`) and `DES-BATCH` (`nx-rust/docs/execution.mara.md`), recording the maintainer's confirmation of 21 November 2026
- [ ] Document the warm-cache same-folder `build` limit and the `--nx-bail` batch limitation in the user-facing guide in `nx-rust/docs/execution.mara.md` (and cross-check `caching.mara.md` / `diagnostics.mara.md` if needed)
- [ ] Verify with `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src` that no active provisional mark remains

Done when: no active provisional mark remains in `nx-rust/docs` or `nx-rust/src`, both limits are documented in the user guide, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
