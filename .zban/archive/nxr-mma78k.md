---
title: Apply the second review answers to the specification
status: done
type: task
priority: high
tags:
  - docs
created_at: 2026-11-12T19:57:33Z
closed_at: 2026-11-12T20:07:21Z
---


The user asked on 2026-11-12 for a review of `AGENTS.md`, both READMEs and `nx-rust/docs/`, answered the questions the review raised, and asked for the documents to be updated. This issue records those answers in Mara and brings the guidance, the READMEs, `AGENTS.md` and the open issues in line with them.

The answers, by the item each one changes:

- [x] Graph creation fails when cargo is missing or `cargo metadata` fails; nothing is skipped (`DES-DISCOVERY`, `DES-DIAGNOSTICS`, `ADR-CARGO-SOURCE-OF-TRUTH`)
- [x] No `^build` opt-in on JS-to-Rust edges: Nx's own rule applies (`REQ-NO-RUST-TASK-DEPS`, `ADR-NO-RUST-BUILD-DEPS`)
- [x] A path dependency without a project is hashed, with a warning where Nx cannot see it (`REQ-INPUT-FILES`, `DES-INPUTS`)
- [x] Nx 24 now, later majors once verified (`REQ-COMPATIBILITY`, `ADR-COMPATIBILITY`)
- [x] The whole crate folder is the crate-file input (`REQ-INPUT-FILES`, `DES-INPUTS`, `REQ-BUILD-SCRIPT-INPUTS`)
- [x] Cargo runs in the workspace root and the toolchain input is `rustc -Vv` there (new design and decision)
- [x] Cargo's own lockfile updates are allowed; a `locked` option adds `--locked` (`REQ-NO-MANIFEST-WRITES`)
- [x] Final artifacts are executables, `cdylib` and `staticlib` files; no caching of them when the artifact directory is outside the repository (`DES-OUTPUTS`)
- [x] Batch results: keep going, fail what depends on the failure, groups in sequence (`REQ-BATCHING`, `DES-BATCH`)
- [x] The test mode is chosen by the consumer, with a default per environment (`DES-TEST-MODE`, `REQ-AFFECTED-TESTS`, new decision)
- [x] Artifact targets are inferred from the manifest (`DES-ARTIFACT-STEPS`)
- [x] Smaller corrections: tool configuration files and more environment variables as inputs, `bench` uncached, tags added, `targetNames` for every inferred target, mentions of the handoff notes reworded
- [x] Inconsistencies the review found without a question are corrected, and open issues whose steps the answers change are updated
- [x] `mara schema validate` and `mara project validate` report `valid: true`, `zban check` reports no errors, and the changed pages are formatted

Done when: the checks above pass.

## Summary of Changes

- Three new accepted items: `DES-INVOCATION` (where cargo runs, no extra flags, `locked`), `ADR-WORKSPACE-ROOT` and `ADR-TEST-MODE-CHOICE`. The other answers changed existing items: `REQ-INPUT-FILES`, `REQ-TOOLCHAIN-KEY`, `REQ-NO-RUST-TASK-DEPS`, `REQ-COMPATIBILITY`, `REQ-DIAGNOSTICS`, `REQ-NO-MANIFEST-WRITES`, `REQ-BATCHING`, `REQ-AFFECTED-TESTS`, `REQ-ARTIFACT-TARGETS`, `REQ-METADATA-OVERRIDES`, `DES-INPUTS`, `DES-OUTPUTS`, `DES-DISCOVERY`, `DES-PROJECT-GRAPH`, `DES-TARGETS`, `DES-BATCH`, `DES-TEST-MODE`, `DES-TEST-RUN`, `DES-BASELINE`, `DES-ARTIFACT-STEPS`, `DES-METADATA-TABLES`, five decisions, five risks and `EVD-NX-24-INSPECTION`.
- Draft items keep their status. Their settled points left the `Open:` paragraphs of `DES-PLUGIN-OPTIONS`, `DES-TARGET-COMMANDS` and `DES-DIAGNOSTICS`; `REQ-BUILD-SCRIPT-INPUTS` now covers only files outside the crate; `REQ-MIXED-PROJECTS` gained the question of how a JS consumer's dependency on a crate enters the project graph.
- Verification follows the changed requirements: `VER-GRAPH`, `VER-CONFIGURATION`, `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED`, `VER-BATCHING`, `VER-TESTING`, `VER-ARTIFACTS` and `VER-SETUP`.
- Guidance, both READMEs and `AGENTS.md` say "Nx 24" and that every machine that runs `nx` needs cargo. Corrected without a question: `fmt-check` in the list of v1 targets, migration from `@monodon/rust` and tests on other triples in the lists of exclusions, the kind of task in the description of a group, and the Cargo version check moved from plugin load to graph creation.
- Eighteen open issues updated where a step contradicted an answer.

Two points go beyond the literal answers and are the user's to confirm. The default test mode without `NX_RUST_TEST_MODE` is `affected` on a developer's machine and `full` where Nx detects CI, which reconciles "pipelines that set nothing run the full suite" with "selection locally without an environment variable". `NX_RUST_LOCKED` exists beside the `locked` option, because an option in `nx.json` cannot differ between CI and developers. One answer was narrowed: with an artifact directory outside the repository only `build` and `doc` run uncached, since the artifact targets store files outside Cargo's directories.

Checks run: `mara schema validate` (valid) and `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check` (no findings), `pnpm exec nx run-many -t build lint test` (succeeded for 2 projects), `oxfmt` on the changed Markdown. `pnpm format:check` still fails on the untracked handoff notes file only, which was left untouched. No code changed, so the end-to-end suite was not run. Nothing is committed.
