---
title: Remove 0.6 provisional marks and document staged-build limits in the guide
status: done
type: task
tags:
  - docs
related:
  - nxr-vk19v5
discovered_from: nxr-vk19v5
created_at: 2026-11-21T20:37:40Z
closed_at: 2026-11-21T21:03:40Z
---

Goal: confirm the two user-visible provisional decisions of milestone 0.6 (`nxr-vk19v5` lines 22 and 25) that the maintainer approved on 21 November 2026, remove the remaining provisional marks, and document both limits in the user-facing guide.

Context:
- `nxr-vk19v5` line 22 (`--nx-bail` under staged builds): confirmed to stand as a documented Nx 24 limitation. Remove the provisional wording in `ADR-STAGED-BUILDS` (`nx-rust/docs/decisions.mara.md`) and `DES-BATCH` (`nx-rust/docs/execution.mara.md`), recording that the maintainer confirmed it on 21 November 2026.
- `nxr-vk19v5` line 25 (warm-cache limit on same-folder `build` refusal): confirmed to stand for v1, and the maintainer asked to make sure it is documented for users. `DES-BATCH` already states the limit; add clear user-facing coverage of both this limit (two `build` tasks of one crate into one folder are refused whenever at least one runs uncached, while if Nx restores both from a warm cache no executor runs and neither is refused, leaving the last-restored files on disk with both cache entries valid) and the `--nx-bail` batch behaviour in the user-facing guide of `nx-rust/docs/execution.mara.md` (and any other relevant guide section, keeping guidance concise and consistent with the normative items).

- [x] Remove the provisional marks in `ADR-STAGED-BUILDS` (`nx-rust/docs/decisions.mara.md`) and `DES-BATCH` (`nx-rust/docs/execution.mara.md`), recording the maintainer's confirmation of 21 November 2026
- [x] Document the warm-cache same-folder `build` limit and the `--nx-bail` batch limitation in the user-facing guide in `nx-rust/docs/execution.mara.md` (and cross-check `caching.mara.md` / `diagnostics.mara.md` if needed)
- [x] Verify with `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src` that no active provisional mark remains

Done when: no active provisional mark remains in `nx-rust/docs` or `nx-rust/src`, both limits are documented in the user guide, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.


## Summary of Changes

- `ADR-STAGED-BUILDS` and `DES-BATCH` (`--nx-bail` under batches): the provisional marks are gone; both record the maintainer's confirmation of 21 November 2026 ("Agree with recommendation") that the behaviour stands as a documented Nx limitation until Nx passes the flag to a batch.
- `DES-BATCH` ("Files that a batch stores"): records the maintainer's confirmation of 21 November 2026 ("Agree, just document this") that the warm-cache limit of the same-folder `build` refusal stands for v1.
- Guide in `nx-rust/docs/execution.mara.md`, "When something fails": a known-limit paragraph on `--nx-bail` in a batch, and a new subsection "Two builds of one crate into one folder" covering the refusal, what to do, and the warm-cache limit. `caching.mara.md` was checked and needs no change; the refusal's message row in `DES-DIAGNOSTICS` (`setup.mara.md`) already exists.
- No source or behaviour change.

Checks: `git grep -n -i provisional -- nx-rust/docs nx-rust/src` leaves one hit, `release.mara.md:389`, a historical record of a different decision that the maintainer overturned (nxr-4884vg), not an active mark. `pnpm nx format:check --all` passed; `mara schema validate` valid; `mara project validate` valid: true, evaluation complete; `zban check` passed. The unit and end-to-end suites were not run: no code changed.

## Decisions made

- The guide advises `--batch=false` for a run that should stop closer to the first failure under `--nx-bail` (Nx then schedules each task on its own); this restates Nx's own behaviour and adds no capability.
- The guide's answer to the warm-cache limit is that a task reading the folder should read only the files it needs: neither a command of its own nor a fresh restore clears a file that only another configuration builds (after review, see below).
- The maintainer's warm-cache confirmation is recorded in `DES-BATCH`, where the limit is stated, rather than in `ADR-STAGED-BUILDS`.

## Changes after review (4fe5eb8)

- Warm-cache limit, corrected in the guide and in `DES-BATCH`: Nx writes the files each restored entry holds and removes none, so the folder holds at each path the file of the entry restored last, and a file that only another configuration builds (a binary with `required-features`) stays; an entry can itself hold such a leftover file. A command of its own does not clear it.
- Confirmed with the plugin (built `dist/nx-rust`, Nx 24.0.6, cargo 1.100.0, `NX_DAEMON=false`) in a fixture under `$TMPDIR`: member `pa` with feature `extra`, binary `pa` and binary `extra` with `required-features = ["extra"]`. `cargo build --features extra`, then `nx run pa:build` (uncached; outputs name `target/debug/{extra,pa}`), then `rm -rf target`, then `nx run pa:build`: a cache hit restored `target/debug/pa` and `target/debug/extra`, and `./target/debug/extra` printed `extra`. So a `build` stores a file at a declared path that it did not produce. No item said so: one sentence added to `DES-OUTPUTS` ("Paths"), and nxr-m1tfp3 filed (deferred backlog).
- Guide, `--nx-bail` paragraph: later groups run apart from tasks whose dependency failed, and Nx stores their results as in any run (not with `--skip-nx-cache`, not for uncached targets).
- Guide, refusal advice: each command's tasks, with what they depend on, may hold only one of the builds; a target that depends on both brings both into one command.
- Filed nxr-jsd437 (deferred backlog): the refusal names the parent of a directory output that both builds declare.

Checks after review: `pnpm nx format:check --all` passed; `mara schema validate` valid; `mara project validate` valid: true, evaluation complete; `zban check` passed; the `provisional` grep still leaves only `release.mara.md:389`. Suites not run: no code changed.
