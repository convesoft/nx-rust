---
title: Specify mixed projects
status: done
type: task
tags:
  - spec
parent: nxr-z9jq1n
blocked_by:
  - nxr-n3d954
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T13:16:57Z
---

Goal: turn the draft item `REQ-MIXED-PROJECTS` (`nx-rust/docs/artifacts.mara.md`) into accepted knowledge with a design, using the result of the spike that blocks this issue.

- [x] Answer the open questions in the item with the user: which name wins, what happens to targets both plugins infer, how a JS consumer's dependency on the crate enters the project graph, and what the consumer's own `^build` then runs on the crate
- [x] Settle with the user how `ADR-NO-RUST-BUILD-DEPS`, `REQ-NO-RUST-TASK-DEPS` and `DES-TARGETS` treat a mixed project whose `build` another plugin replaced. By `EVD-NX-PROJECT-MERGE`, the replacing `build` can be a `package.json` script or a TypeScript build, and the TypeScript `build` keeps its own `dependsOn: ["^build"]`; the three items do not mention this exception yet
- [x] Settle with the user how `REQ-INFERRED-TARGETS` (`nx-rust/docs/targets.mara.md`) treats a crate folder that also is a JS project. It derives each crate's targets from Cargo alone, while by `EVD-NX-PROJECT-MERGE` a `package.json` script or `project.json` target of the same name replaces an inferred target or merges over it. nxr-ag3rec stated this exception in `REQ-INFERRED-PROJECTS` and left `REQ-INFERRED-TARGETS` unchanged
- [x] Include the workspace project's `lockfile` target: a root `package.json` script or `project.json` target with its name replaces it, as it replaces any inferred target, and every cached crate target of that workspace depends on it (`DES-LOCKFILE-HASHING`, "Merged project")
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Extend `VER-CONFIGURATION` so that it checks what happens in a mixed folder to the settings that `REQ-METADATA-OVERRIDES` allows, as `EVD-NX-PROJECT-MERGE` observed it: a `project.json` target and a `package.json` script each replacing an extra target of the plugin, a `project.json` target with only `inputs` merging into the plugin's target, and the same cases for a workspace project whose folder already is an Nx project. So far `VER-CONFIGURATION` checks only the name and the tags in such a folder (found in the review of nxr-ag3rec)
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

- The open questions were decided under the control plane's rule (accepted Mara items first, then the principles, the common setup, the simplest option), not with the user; each decision is listed for the review of the decisions made in 0.4.
- `REQ-MIXED-PROJECTS` accepted, with `DES-MIXED-PROJECTS`, `ADR-MIXED-PROJECT-TARGETS`, `EVD-NX-MIXED-CONSUMER` and `VER-MIXED-PROJECTS`. Name: as `REQ-PROJECT-NAMES` has it. Targets of one name: the plugin keeps its names and neither renames nor reports what the folder's files or a later plugin replace. Consumers: Nx's own `package.json` analysis gives the edge; a JS target that consumes an artifact depends on the artifact target and hashes its outputs with `dependentTasksOutputFiles`; a consumer's `^build` runs the merged `build` with its own `dependsOn`.
- Brought in line: `REQ-INFERRED-TARGETS` and `REQ-NO-RUST-TASK-DEPS` (one sentence each, marked provisional in their text), `ADR-NO-RUST-BUILD-DEPS`, `DES-TARGETS`, `DES-LOCKFILE-HASHING` ("Merged project"), `DES-ARTIFACT-STEPS`, `RISK-MIXED-PROJECT-MERGE`, `VER-CONFIGURATION`, `VER-CACHE-KEYS`, `VER-ARTIFACTS`; user guidance in `artifacts.mara.md` (new section "A crate that is also a JS package") and `targets.mara.md`.
- Experiments with the real Nx 24.0.6 are recorded in `EVD-NX-MIXED-CONSUMER`. New tests: 8 cases in `configuration.spec.ts`, 4 in `mixed-projects.spec.ts`.
- Issues: the consumer-key check added to nxr-tv3r95 and nxr-0ap8n4; backlog nxr-fwq2yw (a replaced lockfile task fails after cargo with a misleading message).
- Rejected: renaming colliding inferred targets, reporting the collision (see `ADR-MIXED-PROJECT-TARGETS`).
- Checks run: `mara schema validate` (valid), `mara project validate` (valid: true, evaluation complete, 0 diagnostics), `zban check`, `pnpm nx format:check --all`, `pnpm nx run-many -t build lint test --skip-nx-cache` (54 suites, 1718 passed, 1 todo).
