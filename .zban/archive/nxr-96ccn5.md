---
title: Write the initial specification, README and agent instructions
status: done
type: task
priority: high
tags:
  - docs
created_at: 2026-11-12T18:03:57Z
closed_at: 2026-11-12T18:20:51Z
---

Turn the design handoff notes (`Nx Cargo plugin design handoff notes.md`, untracked at the repository root) and the answers given on 2026-11-12 into the project's durable documents.

Answers that shaped the documents: the primary audience is mixed JS/TS + Rust Nx monorepos; delivery is staged in 0.x milestones; Nx 24 and later, Cargo 1.91 and later, Linux and macOS; overrides live under `[package.metadata.nx]` and `[workspace.metadata.nx]`; targets use Nx names by default (`lint` runs clippy) and can be renamed; dev-dependency edges stay in the graph; v1 ships `init` and crate generators; decided content is `accepted` in Mara and undecided content is `draft`.

- [x] Mara pages in `nx-rust/docs/` that serve as user guide and specification
- [x] Root `README.md` and the package `nx-rust/README.md`
- [x] `AGENTS.md`, with `CLAUDE.md` as a symlink to it
- [x] Backlog in zban: one epic per milestone, plus spec tasks and spikes for the notes' open points
- [x] `mara schema validate` and `mara project validate` report `valid: true`
- [x] `zban check` reports no errors

## Summary of Changes

- Thirteen pages in `nx-rust/docs/`, each opening with user guidance and followed by its Mara items: 145 items, 132 accepted and 13 draft. The draft items are the areas the handoff notes call not yet designed, each ending with its open questions.
- Root `README.md` and `nx-rust/README.md` rewritten from the Nx boilerplate. `AGENTS.md` written, `CLAUDE.md` is a symlink to it.
- Backlog: six milestone epics (0.1 to 0.5 and 1.0) and 45 feature, spec and spike issues that cite Mara IDs.
- `EVD-NX-24-INSPECTION` records what was checked in the installed Nx 24.0.6. It settles the handoff notes' open point that `dependsOn` cannot pin a configuration, so that point has no spike.

Checks run: `mara schema validate` and `mara project validate` (both `valid: true`, evaluation complete), `zban check` (no findings), `pnpm exec nx run-many -t build lint test` (4 tasks succeeded), `oxfmt --check` on the new and changed Markdown (clean).

Known limits: `pnpm format:check` fails on the untracked handoff notes file, which was left untouched on request. The end-to-end suite was not run; no code changed. Nothing is committed.
