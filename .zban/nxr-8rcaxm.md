---
title: Let nx add write empty target defaults for the plugin's executors
status: in-progress
type: feature
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-d3087e
created_at: 2026-11-13T16:46:44Z
---

Goal: `nx add @convesoft/nx-rust` works in a workspace whose `targetDefaults` are keyed by target name, without a manual edit.

The maintainer's decision, word for word: "nx add writes the shielding entries (Recommended)": `nx add` adds empty target-default entries keyed by the plugin's own executors when they are missing. Nx then uses those for Rust targets and the name-keyed entries keep applying to JS only. It never changes an existing entry. This narrows his earlier answer "never edit" (nxr-d3087e) to "never edit an existing entry".

Context:
- Nx picks a target's defaults by its executor first, and by its name only if no executor entry exists (`EVD-NX-TARGET-DEFAULTS`).
- An empty entry for `@convesoft/nx-rust:cargo` and `@convesoft/nx-rust:run` keeps name-keyed defaults away from Rust targets. The review of pull request #32 confirmed this on Nx 24.0.6.
- The report of `REQ-TARGET-DEFAULT-GUARD` / `DES-TARGET-DEFAULT-GUARD` stays as the graph-time check for repositories set up by hand or changed later. Its message names the same fix.

- [ ] `init` adds the entries when they are missing, says in its output which it added and why, and never changes or removes an existing entry. A repository that already has an entry for one of the executors keeps it as it is, and the report judges it as before
- [ ] The order of `init`'s steps: the graph check runs on the configuration as it will be once the entries are added, so that a name-keyed default no longer stops `init`; nothing is written when another check fails
- [ ] Amend `DES-GENERATORS`, `REQ-INIT` if it says that `init` writes only the plugin entry, `DES-TARGET-DEFAULT-GUARD`, `VER-SETUP` and the guidance on narrowing an entry (`nx-rust/docs/setup.mara.md`, `targets.mara.md`, `verification.mara.md`)
- [ ] Tests through a real `nx add` in workspaces with a name-keyed `build` default (`cache`, `dependsOn: ["^build"]`, `inputs`), with executor-keyed defaults only, with an existing entry for the plugin's executor, and with a repeated `nx add`
- [ ] The executor of the `lockfile` task (`@convesoft/nx-rust:lockfile`, nxr-xq9ava) needs its entry too once it exists; nxr-xq9ava has a step for it

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
