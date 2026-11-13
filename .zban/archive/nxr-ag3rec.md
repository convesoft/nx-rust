---
title: Reconcile Cargo-derived names and overrides with mixed folders
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-gdt96k
discovered_from: nxr-n3d954
created_at: 2026-11-13T10:28:37Z
closed_at: 2026-11-13T11:52:21Z
---

Goal: bring three accepted items in line with `EVD-NX-PROJECT-MERGE` (`nx-rust/docs/decisions.mara.md`) for a crate folder that also is a JS project, the case `REQ-PROJECT-NAMES` now covers. The review of the pull request for nxr-n3d954 found them. Changing accepted items needs the maintainer's agreement.

- `REQ-INFERRED-PROJECTS` (`nx-rust/docs/workspaces.mara.md`) derives every member's project name and targets from Cargo. The evidence shows that in such a folder Nx takes the name from `package.json` or from a `project.json` that sets one. A same-named script or target that runs something else replaces an inferred target.
- `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` (`nx-rust/docs/configuration.mara.md`) let `[package.metadata.nx]` set a crate's project name and the settings of its inferred targets. By the evidence, the `name` key has no effect in such a folder, and settings the plugin puts on an inferred target, overrides included, are lost when a same-named script or target replaces it. Tags still combine.

Context: nxr-gdt96k extends `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` for the workspace project once the pull request for nxr-n3d954 is merged. Agree the order of the two changes, so that neither undoes the other.

- [x] Propose wording for the three items to the maintainer, citing `EVD-NX-PROJECT-MERGE` and `REQ-PROJECT-NAMES`
- [x] Apply the agreed wording, and bring the user guidance at the top of `configuration.mara.md` in line with it
- [x] Coordinate the change with nxr-gdt96k

Done when: the maintainer has agreed to the wording, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.

## Summary of Changes

- The maintainer agreed to the wording on 2026-11-13. Applied word for word on top of nxr-gdt96k (#11), which landed first, as agreed. nxr-9f4w3f lands after this.
- `REQ-INFERRED-PROJECTS`: the plugin derives the name, targets and dependencies it gives a member from Cargo. In a crate folder that also is a JS project, the name Nx takes from `package.json` or `project.json`, and their scripts and targets named like the plugin's, take precedence.
- `REQ-METADATA-OVERRIDES`: new closing sentences for any project whose folder also is a JS project, so they cover the workspace project too. The name Nx takes from those files applies instead. A script or target of the same name replaces a target, with its settings, unless Nx merges the two. Tags are kept from both. The sentence #11 added stays word for word, and nothing overlapped it.
- `DES-METADATA-TABLES`: a closing paragraph that points to `REQ-METADATA-OVERRIDES`. The rows and the precedence paragraph are untouched; nxr-9f4w3f owns them.
- `VER-CONFIGURATION`: the agreed check for a crate folder with a `package.json` that Nx reads (name and tags), added as its own last paragraph after the two that #8 and #11 left.
- `EVD-NX-PROJECT-MERGE` now supports `REQ-INFERRED-PROJECTS`, `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES`.
- Guidance:
  - "Per crate" in `configuration.mara.md` says what Nx does with the table in such a folder, linking to "Project names" and to the artifacts page.
  - "Project names" in `workspaces.mara.md` limits the no-effect statement to where Nx takes the name from one of those files, like #11's text for the workspace project. A crate folder whose only Nx file is a `project.json` without a name keeps the plugin's name; this was checked on Nx 24.0.6 while the brief was prepared.
- nxr-ym403k gained a step for `REQ-INFERRED-TARGETS`, which has the same overstatement. That requirement is unchanged here, as agreed.
- Checks:
  - `pnpm nx format:write` was run.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, 0 errors and 0 warnings, all pages read.
  - `zban check`: no findings.
  - `pnpm nx run-many -t build lint test`: passed.
  - `pnpm nx format:check --all`: passed.
  - `pnpm nx e2e nx-rust-e2e` was not run, because the built plugin did not change.
- Rejected approaches: editing the rows of `DES-METADATA-TABLES`, which nxr-9f4w3f rewrites; changing `REQ-INFERRED-TARGETS` here.
