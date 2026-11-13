---
title: Let nx add write empty target defaults for the plugin's executors
status: done
type: feature
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-d3087e
created_at: 2026-11-13T16:46:44Z
closed_at: 2026-11-13T18:00:28Z
---

Goal: `nx add @convesoft/nx-rust` works in a workspace whose `targetDefaults` are keyed by target name, without a manual edit.

The maintainer's decision, word for word: "nx add writes the shielding entries (Recommended)": `nx add` adds empty target-default entries keyed by the plugin's own executors when they are missing. Nx then uses those for Rust targets and the name-keyed entries keep applying to JS only. It never changes an existing entry. This narrows his earlier answer "never edit" (nxr-d3087e) to "never edit an existing entry".

Context:
- Nx picks a target's defaults by its executor first, and by its name only if no executor entry exists (`EVD-NX-TARGET-DEFAULTS`).
- An empty entry for `@convesoft/nx-rust:cargo` and `@convesoft/nx-rust:run` keeps name-keyed defaults away from Rust targets. The review of pull request #32 confirmed this on Nx 24.0.6.
- The report of `REQ-TARGET-DEFAULT-GUARD` / `DES-TARGET-DEFAULT-GUARD` stays as the graph-time check for repositories set up by hand or changed later. Its message names the same fix.

- [x] `init` adds the entries when they are missing, says in its output which it added and why, and never changes or removes an existing entry. A repository that already has an entry for one of the executors keeps it as it is, and the report judges it as before
- [x] The order of `init`'s steps: the graph check runs on the configuration as it will be once the entries are added, so that a name-keyed default no longer stops `init`; nothing is written when another check fails
- [x] Amend `DES-GENERATORS`, `REQ-INIT` if it says that `init` writes only the plugin entry, `DES-TARGET-DEFAULT-GUARD`, `VER-SETUP` and the guidance on narrowing an entry (`nx-rust/docs/setup.mara.md`, `targets.mara.md`, `verification.mara.md`)
- [x] Tests through a real `nx add` in workspaces with a name-keyed `build` default (`cache`, `dependsOn: ["^build"]`, `inputs`), with executor-keyed defaults only, with an existing entry for the plugin's executor, and with a repeated `nx add`
- [x] The executor of the `lockfile` task (`@convesoft/nx-rust:lockfile`, nxr-xq9ava) needs its entry too once it exists; nxr-xq9ava has a step for it

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

- Code (`nx-rust/src/generators/init/init.ts`):
  - `init` reads `nx.json` and works out which of `shieldedExecutors` (`@convesoft/nx-rust:cargo` and `@convesoft/nx-rust:run`) have no `targetDefaults` key.
  - It runs its graph check on `nx.json` with the plugin entry and those empty entries added. A name-keyed default therefore no longer stops `init`, and any other failing check still stops it before anything is written.
  - It then writes the plugin entry, if missing, and the missing entries after the existing ones. Where `nx.json` extends a file that alone has `targetDefaults`, the combined object goes into `nx.json`, as for `plugins`.
  - It prints which entries it added and why: Nx chooses an executor key before a name or glob key.
  - It never changes or removes an existing entry. One keyed by the plugin's executor is judged by `DES-TARGET-DEFAULT-GUARD` as before.
  - The schema and `generators.json` descriptions mention the entries.
- Lockfile step: nxr-xq9ava has the step that adds `@convesoft/nx-rust:lockfile` once that executor exists. The list to extend is `shieldedExecutors` in `init.ts`.
- Mara:
  - `DES-GENERATORS`: the intro, step 1 (checks `nx.json` as step 2 leaves it), step 2 (the empty entries, never changing an existing one, the `extends` case) and step 3 (the report line).
  - `DES-TARGET-DEFAULT-GUARD`: "Where" says that `init` judges `nx.json` with the entries, and what the report covers then. "Message" says that graph creation never edits `targetDefaults` and that `init` only adds the missing empty entries.
  - `VER-SETUP`: the fresh `nx add`, the second run, the `extends` case, the error case narrowed to entries keyed by the plugin's executors, and the real `nx add` cases.
  - `VER-TARGET-DEFAULT-GUARD`: its `init` paragraph.
  - User guidance in `setup.mara.md` ("Adding the plugin", including the by-hand `nx.json`) and in `targets.mara.md` ("No `^build` between crates", "Target defaults that reach Rust targets", "Options that cargo does not use").
  - `REQ-INIT` does not say that `init` writes only the plugin entry, so it is unchanged.
- Tests:
  - `nx-rust/test/target-defaults.spec.ts` (`init`, through `nx g`):
    - name-keyed entries: `fmt`/`build` caching, `update` inputs, and `build` with `cache`, `^build` and `inputs`;
    - entries keyed by other executors only;
    - an executor key with `cache: true`, which fails and leaves `nx.json` unchanged;
    - an executor key with `^build`, which is kept and warned about while only the `run` entry is added;
    - both entries present, so nothing is added;
    - a `cargo metadata` failure beside a name-keyed default, which writes nothing.
  - `nx-rust/test/init.spec.ts`: the new `nx.json` expectations, a registered plugin with one entry missing, and the `extends` case.
  - `nx-rust-e2e/src/nx-rust.spec.ts`, through a real `nx add` from the local registry:
    - the main install now expects the entries;
    - a name-keyed `build` default (`cache`, `^build`, `inputs`) beside a JS project: the default reaches `web` and not `api`, and a second `nx add` writes nothing;
    - entries keyed by other executors only;
    - an existing cargo-executor entry that warns;
    - one that stops `nx add`.
- Checks, after merging `origin/main` at 74fad71 (#37, #39):
  - `pnpm nx run-many -t build lint test`: 20 suites, 595 tests passed.
  - `pnpm nx format:check --all`: passed.
  - `pnpm nx e2e nx-rust-e2e`: 24 of 24 passed.
  - `mara schema validate`: valid.
  - `mara project validate`: `valid: true`, evaluation complete, no errors or warnings, every policy check passed.
  - `zban check`: no problems.
