---
title: Carry the envInputs and runtimeInputs of the crates behind a left-out edge
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-vaywmh
created_at: 2026-11-14T08:39:26Z
closed_at: 2026-11-14T09:39:45Z
---

Goal: where `DES-PROJECT-GRAPH` leaves out a member's use of a crate with a project, the member's keys follow the variables and commands that the crates the edge would have brought add with `envInputs` and `runtimeInputs`, as they would through `^default` (`GOAL-TRUSTED-CACHE`, `DES-INPUTS`).

Found while fixing the review finding of nxr-vaywmh. In place of a left-out edge, the member's targets now get the folder, workspace manifest and declared files of the crate and of every crate cargo builds with it (`RedirectedUse.brings` in `nx-rust/src/graph/redirected-uses.ts`, the left-out entries in `path-dependencies.ts`). The edge would also have brought each crate's `default` named input, which holds the `envInputs` and `runtimeInputs` from that crate's own table and from its workspace's table (`namedInputs` in `nx-rust/src/graph/inputs.ts`). The fallback carries none of them. A variable that a crate behind the left-out edge declares, and that its build reads, can therefore change without changing the member's keys. The control plane's decision for nxr-vaywmh named only folders and declared files, so this was left out.

Related: a path dependency without a project carries only its `fileInputs` too (`DES-INPUTS`, "Declared files"). Decide whether both should carry `envInputs` and `runtimeInputs`.

- [x] Decide, and update `DES-INPUTS` and `VER-CACHE-KEYS`
- [x] Implement it, with a test with the real hasher in which a variable that a crate behind a left-out edge declares changes the member's keys

## Summary of Changes

Decided by the control plane under `GOAL-TRUSTED-CACHE`: invalidating more than necessary is fine, but a key that stays the same after a change the member's build reads is not.

1. Wherever the member gets file inputs in place of an edge, it also gets what the edge would have brought through the crate's `default` named input beyond files: the `envInputs` and `runtimeInputs` from that crate's own table and from its workspace's table. This holds for every crate in the set that #63 brings for a left-out use (the crate, and everything it reaches through normal and build dependencies), for a redirected crate without a project, and, as "Related" asked, for a path dependency without a project together with the crates without a project behind it.
2. A variable or command reached several ways is declared once. A runtime command tied to a folder runs where it would have run for the crate that declares it. Nx runs every runtime input through `sh -c` in the repository root, whichever project's input names it (`EVD-NX-24-INPUT-SEMANTICS`), so the plugin passes the command unchanged (`DES-INPUTS`, "Added variables and commands").
3. Keys of repositories without such shapes stay exactly as they are.

Settled here without a product question:

- A crate whose files Nx cannot see (ignored, or outside the repository) still adds its variables and commands. They are not files, and this only adds invalidation.
- A value of the wrong type in such a crate's table fails graph creation, as it does for a project.
- A variable or command is dropped where the member's own named input or another input of the target already names it.

Implementation: `readCrateAddedInputs` (`settings.ts`); `PathDependency.added` and `crateInputs` (`path-dependencies.ts`), read from the crate's report; `withoutRepeatedAdditions` (`inputs.ts`). The path-dependency entries go into the member's named input and the left-out-edge entries onto its targets, beside the folders. Mara: `DES-INPUTS` (the table rows "Path dependencies" and "Redirected crates", and a new paragraph "Added variables and commands") and `VER-CACHE-KEYS`, plus the guidance in `caching.mara.md`.

Checks run:

- `cache-keys.spec.ts`, "keys with the variables and commands of a crate without an edge": 10 rows with the real hasher, all passing. They cover a variable in a path dependency's own table and in its workspace's table, behind another crate without a project; a command; a path dependency that Nx cannot see; a redirected crate without a project; an edge left out to avoid a cycle; and, for a left-out pair of possible uses, the crate's own variable, a variable of a crate behind it in another workspace, that workspace's table, and a command. With the added inputs removed from `crateInputs`, all 10 fail.
- `redirections.spec.ts`, "give the member each variable and command that the crates behind it add once…": each variable and command appears once in the member's named input and target inputs.
- Keys unchanged: for every fixture (`name-collision` fails graph creation by design) and the `paths` variant of #63, I recorded the target inputs, named inputs and per-input hash details of every task before and after the change. They are identical, apart from the harness's per-run `nx.json`, which also differs between two runs on unchanged code.
- `nx affected` selects tasks by changed files only, so these tests check keys rather than `nx show projects --affected`.
- `pnpm nx run-many -t build lint test` passed: 33 suites, 1035 tests, 1 todo that was already there. So did `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`.
