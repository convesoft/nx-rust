---
title: Reconcile Cargo-derived names and overrides with mixed folders
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-gdt96k
discovered_from: nxr-n3d954
created_at: 2026-11-13T10:28:37Z
---

Goal: bring three accepted items in line with `EVD-NX-PROJECT-MERGE` (`nx-rust/docs/decisions.mara.md`) for a crate folder that also is a JS project, the case `REQ-PROJECT-NAMES` now covers. The review of the pull request for nxr-n3d954 found them. Changing accepted items needs the maintainer's agreement.

- `REQ-INFERRED-PROJECTS` (`nx-rust/docs/workspaces.mara.md`) derives every member's project name and targets from Cargo. The evidence shows that in such a folder Nx takes the name from `package.json` or from a `project.json` that sets one. A same-named script or target that runs something else replaces an inferred target.
- `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` (`nx-rust/docs/configuration.mara.md`) let `[package.metadata.nx]` set a crate's project name and the settings of its inferred targets. By the evidence, the `name` key has no effect in such a folder, and settings the plugin puts on an inferred target, overrides included, are lost when a same-named script or target replaces it. Tags still combine.

Context: nxr-gdt96k extends `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` for the workspace project once the pull request for nxr-n3d954 is merged. Agree the order of the two changes, so that neither undoes the other.

- [ ] Propose wording for the three items to the maintainer, citing `EVD-NX-PROJECT-MERGE` and `REQ-PROJECT-NAMES`
- [ ] Apply the agreed wording, and bring the user guidance at the top of `configuration.mara.md` in line with it
- [ ] Coordinate the change with nxr-gdt96k

Done when: the maintainer has agreed to the wording, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.
