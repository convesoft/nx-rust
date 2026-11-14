---
title: Cache the SCIP index that Mara builds for the TypeScript sources
status: done
type: task
tags:
  - infra
created_at: 2026-11-14T16:16:27Z
closed_at: 2026-11-14T16:54:03Z
---

Goal: Mara calls in this repository (`mara get`, `mara related`, item edits, `mara project validate`) stop paying for a full `scip-typescript` run when the indexed sources have not changed, and the code links from `// @mara implements <ID>` markers stay exactly as they are.

Context: `.mara/project.toml` has one `[[code.languages]]` entry whose `command` runs `scip-typescript` over `nx-rust` and `nx-rust-e2e`. Mara 0.4.0-alpha.1 keeps no SCIP index between calls, so every call runs the indexer. Measured on 14 November 2026, `mara get` and `mara related` took 3.1 to 4.1 s and `mara project validate` 25.6 s. Removing the language entry is not an option: a marker links through the SCIP symbol of the declaration that owns the comment, and `command` is a required field. The maintainer approved a caching wrapper in `.mara/` on 14 November 2026.

- [x] Add a Node script without dependencies under `.mara/code/` that runs the real indexer only when its cache key changed, and otherwise copies the last index to Mara's `{output}`
- [x] Have the key cover the paths and content of the indexed sources, the `tsconfig*.json` and `package.json` files, `pnpm-lock.yaml`, the indexer's command line and the checkout's path, so that deleted and renamed files change it too
- [x] Keep the cache per checkout in a git-ignored folder, small, written atomically, with failed runs not cached and corrupt entries treated as misses
- [x] Add an environment variable that turns the cache off
- [x] Point the `command` in `.mara/project.toml` at the script; change nothing else in `.mara/`
- [x] Show that `mara related` for at least five marked designs and `mara project validate` give the same output with and without the cache, cold and warm
- [x] Show that adding, removing and renaming a marked declaration, and changing a `tsconfig` file, show up on the next call
- [x] Show that twenty Mara reads started at once on a cold cache all succeed
- [x] Measure `mara get`, `mara related` and `mara project validate` before and after, cold and warm
- [x] Update the Mara section of `AGENTS.md` and the note in nxr-0x99we

Done when: the comparisons above match, the timings are recorded in the summary, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

`.mara/code/scip-index-cache.cjs` (CommonJS, no dependencies) now wraps `scip-typescript`: the `command` in `.mara/project.toml` runs it with `{output}` and the old command, which names Mara's output `@OUTPUT@`. Nothing else in `.mara/` changed. After review, the script's header states what the cache promises (the control plane's decision). The key covers every file git does not ignore that the indexer can read (`git ls-files -z -co --exclude-standard`), the configuration files that the `extends` and `references` chains of the indexer's tsconfig files reach, wherever they lie, pnpm's record of the installed state (`node_modules/.modules.yaml`, `node_modules/.pnpm/lock.yaml`), the versions of the installed indexer, of TypeScript and of Node, the command, the checkout's path and the script. Ignored files, hand edits in `node_modules` and whether the indexer can still start are outside the promise. When git fails, a chain link is missing or unreadable, or the installed state cannot be read, the call runs uncached. Computing the key takes 6 to 13 ms. The cache lives in `node_modules/.cache/mara-scip-index/` (git-ignored) and keeps four entries. Entries are named by key and content SHA-256 and written with temporary file, fsync and rename; a corrupt or empty entry counts as a miss. A PID lock lets one process index while others wait. Failed runs store nothing. Without `node_modules` the first call runs uncached (pnpm 12 installs the dependencies). `SCIP_INDEX_CACHE=0` bypasses the cache; `AGENTS.md` and nxr-0x99we name the script.

Results:

- `mara get` and `mara related … --direction incoming --limit 100` for seven marked designs gave byte-identical output with the original command and the wrapper, cold and warm.
- `mara project validate` (human and two JSON pages) was byte-identical with the wrapper cold, warm and with the cache off. Against the original command it differs only in input hashes, which any project file change alters (control runs).
- In a scratch worktree, adding, renaming and removing marked declarations, a `tsconfig.lib.json` change, a file move and a file deletion each caused a reindex on the next call, with output equal to the cache-off output; the rename also matched the original command's output.
- Twenty concurrent cold reads all succeeded with one indexer run.
- Timings (before / cold / warm), from the first version: `mara get` 2.45 / 2.50 / 0.45 s, `mara related` 2.43 / 2.54 / 0.46 s, `mara project validate` 19.3 / 19.4 / 17.2 s.

After review (new key):

- The seven-item comparisons, the edits (plus an untracked new file and an unstaged deletion) and twenty concurrent reads gave the same results.
- A tsconfig chain through a dot folder git does not ignore, or through ignored `tmp/`, reindexes when the extended file changes; a missing link runs uncached. Both match the cache-off output.
- `pnpm add -D @types/node@24.19.2` changes both record files and reindexes. Reverting the tracked files without reinstalling still changes the key, and reinstalling restores the record and the key.
- As the promise says, a declaration in ignored `dist/` that a source imports stays as cached, and a hit succeeds with `pnpm` missing from `PATH`. Without git, or outside a git checkout, the call runs uncached.
- Timings on a busier machine (before / cold / warm): `mara get` 3.1 / 3.1 / 0.55 s, `mara related` 3.0 / 3.1 / 0.55 s, `mara project validate` 22.4–23.2 / 22.3 / 19.7 s.

Checks run:

- `pnpm nx run-many -t build lint test` (36 suites, 1146 passed, 1 todo), with the first version; the change after review touches only the script and needs no rerun
- `pnpm nx format:check --all`, after merging local `main` at 45e0038
- `oxlint` and oxfmt's defaults on the script by hand, since nothing in the workspace lints or formats `.mara/code/*.cjs`
- `mara schema validate`
- `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings)
- `zban check`

No Mara item describes how the knowledge base is validated, so none changed.
