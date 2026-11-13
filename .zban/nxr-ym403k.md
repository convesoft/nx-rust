---
title: Specify mixed projects
status: todo
type: task
tags:
  - spec
parent: nxr-z9jq1n
blocked_by:
  - nxr-n3d954
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `REQ-MIXED-PROJECTS` (`nx-rust/docs/artifacts.mara.md`) into accepted knowledge with a design, using the result of the spike that blocks this issue.

- [ ] Answer the open questions in the item with the user: which name wins, what happens to targets both plugins infer, how a JS consumer's dependency on the crate enters the project graph, and what the consumer's own `^build` then runs on the crate
- [ ] Settle with the user how `ADR-NO-RUST-BUILD-DEPS`, `REQ-NO-RUST-TASK-DEPS` and `DES-TARGETS` treat a mixed project whose `build` another plugin replaced. By `EVD-NX-PROJECT-MERGE`, the replacing `build` can be a `package.json` script or a TypeScript build, and the TypeScript `build` keeps its own `dependsOn: ["^build"]`; the three items do not mention this exception yet
- [ ] Settle with the user how `REQ-INFERRED-TARGETS` (`nx-rust/docs/targets.mara.md`) treats a crate folder that also is a JS project. It derives each crate's targets from Cargo alone, while by `EVD-NX-PROJECT-MERGE` a `package.json` script or `project.json` target of the same name replaces an inferred target or merges over it. nxr-ag3rec stated this exception in `REQ-INFERRED-PROJECTS` and left `REQ-INFERRED-TARGETS` unchanged
- [ ] Include the workspace project's `lockfile` target: a root `package.json` script or `project.json` target with its name replaces it, as it replaces any inferred target, and every cached crate target of that workspace depends on it (`DES-LOCKFILE-HASHING`, "Merged project")
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Extend `VER-CONFIGURATION` so that it checks what happens in a mixed folder to the settings that `REQ-METADATA-OVERRIDES` allows, as `EVD-NX-PROJECT-MERGE` observed it: a `project.json` target and a `package.json` script each replacing an extra target of the plugin, a `project.json` target with only `inputs` merging into the plugin's target, and the same cases for a workspace project whose folder already is an Nx project. So far `VER-CONFIGURATION` checks only the name and the tags in such a folder (found in the review of nxr-ag3rec)
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
