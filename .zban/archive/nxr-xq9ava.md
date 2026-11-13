---
title: Hash external dependencies per crate
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-pn1hwr
  - nxr-fy4t4k
related:
  - nxr-8rcaxm
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T19:36:04Z
---

Goal: a lockfile change invalidates only the crates whose resolved dependencies it changes, `nx affected` still selects them, and no result is stored or restored under a key from a lockfile that cargo would still change.

Implements `REQ-EXTERNAL-DEPS` through `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`), with:
- the `lockfile` rows of `DES-TARGETS` and `DES-WORKSPACE-TARGETS`;
- the exception in `REQ-NO-RUST-TASK-DEPS`;
- the lockfile rows of `DES-INPUTS`, the crate-file exclusion of `REQ-INPUT-FILES`, and the lockfile call of `DES-INVOCATION`;
- the two lockfile rows of `DES-DIAGNOSTICS`.

Checked by `VER-CACHE-KEYS`, `VER-TARGETS` and `VER-SETUP`. `EVD-CARGO-LOCK-CHECK` and `EVD-NX-24-LOCKFILE-UPDATE` record what cargo and Nx do.

- [x] The `lockfile` target on every workspace project, and on the root crate's project where the root manifest is a package: not cached; an executor without a batch implementation; `cargo update --workspace` in the workspace root, with `--locked` in locked mode; failing with cargo's message when cargo fails
- [x] Its inputs for `nx affected`: `Cargo.lock` with `includeIgnored`, the root manifest, and the manifests of the members and of path packages in the repository, named from the repository root; the workspace files
- [x] After cargo, the digest per member from `Cargo.lock`: the reachable graph through every listed dependency and path package, following `replace = …`, without `[[patch.unused]]`, serialised as `DES-LOCKFILE-HASHING` says (one tab-joined line per entry with its sorted dependency strings); one output folder per workspace under `.nx/workspace-data/nx-rust/lockfile/`
- [x] The `preTasksExecution` hook sets `NX_RUST_RUN_ID` to a new value when the command excludes task dependencies and to the empty string otherwise; an `env` input for it on every cached crate target with a digest input. The hook exists since nxr-wea5vt: add the variable as a second entry of the object that `commandRecords` returns in `nx-rust/src/executors/nx-command.ts`, computed from the same `argv` (`process.argv` of the `nx` command); `preTasksExecution` there assigns every entry on every command, which is what keeps a value of an earlier command out of the daemon's tasks. Nx's own `yargs-parser` is loaded there for `parseAsNx`; load it the same way to parse the command, with the configuration that the command needs
- [x] Every cached crate target other than `fmt-check` depends on its workspace's `lockfile` task and reads its digest through `dependentTasksOutputFiles`; `doc` reads all digests; no cached target that runs cargo has `Cargo.lock` as a file input
- [x] The crate at a workspace root, standalone crates included, leaves its workspace's `Cargo.lock` out of its crate files (done in nxr-fy4t4k: `namedInputs` in `nx-rust/src/graph/inputs.ts`)
- [x] The post-check after the cargo call of a cached task, in the step of `DES-BUILD-INPUT-CHECK`: the crate's digest computed again, failing the task when it differs from its digest file
- [x] Replace the interim input of nxr-fy4t4k, the workspace's whole `Cargo.lock` as a fileset with `includeIgnored` (`externalDependencyInputs` in `nx-rust/src/graph/inputs.ts`), with the crate's digest as the "External dependencies" row of `DES-INPUTS` gives it, and remove the interim from the status note of `nx-rust/docs/caching.mara.md`. The rows of `VER-CACHE-KEYS` that the whole lockfile cannot pass become checkable then: a locked version bump outside a crate's resolved dependencies, also for the crate at the root of its workspace, for a standalone crate and for the crates that depend on either, must not change its keys (`nx-rust/test/cache-keys.spec.ts` has the rows that the whole lockfile passes)
- [x] The rows of `VER-CACHE-KEYS` for the lockfile (sibling requirement, feature, `[replace]`, the registry case, an edge change between current lockfiles) and its end-to-end checks, with `--exclude-task-dependencies` among them
- [x] The `lockfile` checks of `VER-TARGETS` and `VER-SETUP`
- [x] Add `lockfile` to `inferredTargetNames` and `inferTargets` (`nx-rust/src/graph/targets.ts`), so that `targetNames` accepts and renames it with the collision check (`DES-TARGETS`, `DES-PLUGIN-OPTIONS`); until then `targetNames` rejects the key `lockfile`. Add the `dependsOn` of the cached crate targets other than `fmt-check` on it (`REQ-NO-RUST-TASK-DEPS`, `DES-LOCKFILE-HASHING`). The tests in `nx-rust/test/targets.spec.ts` that no inferred target has a `dependsOn`, that the task graph of `nx run-many -t build test lint` has no edges, that a JS `^build` reaches only the crate's `build`, and the expected target lists of workspace projects then change with this issue, as does the end-to-end check of the task graph in `nx-rust-e2e/src/nx-rust.spec.ts`
- [x] Add the case of `VER-TARGET-DEFAULT-GUARD` for a target default that replaces a crate target's `dependsOn` and so loses the dependency on the `lockfile` task to `nx-rust/test/target-defaults.spec.ts`, with the real dependency in place of the stand-in there. The report compares with the inferred `dependsOn` (`DES-TARGET-DEFAULT-GUARD`), so it reports this without a change, and `build: { dependsOn: ["^build"] }` then fails graph creation: the warning cases of that file, `init`'s included, need `"..."` in the list from then on
- [x] The executor of the `lockfile` task (`@convesoft/nx-rust:lockfile`) needs an empty target-default entry from `nx add`, as nxr-8rcaxm gives the plugin's other executors: add it to that list if nxr-8rcaxm has landed, or leave a note there if it has not

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- Every workspace project, and the root crate's project where the root manifest is a package, has the uncached `lockfile` target run by the new executor `@convesoft/nx-rust:lockfile` (no batch implementation). It runs `cargo update --workspace`, with `--locked` in locked mode, in the workspace root, then writes one digest per member (`memberDigest` in `nx-rust/src/cargo/lockfile.ts`) into `.nx/workspace-data/nx-rust/lockfile/<workspace>`, where `<workspace>` is one percent-encoded path segment, so that the folders of nested workspaces never contain each other. Its inputs are those of `DES-WORKSPACE-TARGETS`, named from the repository root, path packages and `[patch]`/`[replace]` crates included.
- Every cached crate target but `fmt-check`, and `doc`, depends on that task through `{ projects: ["directory:<workspace root>"], target: <lockfile name> }`, so that the dependency holds when a `project.json` renames the workspace project. It hashes its digest (`doc`: all of them) through `dependentTasksOutputFiles` and `NX_RUST_RUN_ID` as an `env` input. The interim whole-`Cargo.lock` input is gone from the cached targets. `bench`, `run`, and `build`/`doc` where uncached, keep the plain `Cargo.lock` for `nx affected` (recorded in `DES-INPUTS`, "Uncached targets").
- `commandRecords` sets `NX_RUST_RUN_ID` to a random UUID when Nx's own `yargs-parser` reads `excludeTaskDependencies` as true, and to "" otherwise.
- After cargo's call, a task whose key holds digests computes them again and fails on a difference (`checkDigests`). Before cargo, a task whose task graph lacks the lockfile dependency in a run that does not exclude task dependencies fails (`keyHoldsDigests`), as where a `project.json` replaces `dependsOn` or no project lies at the workspace root. The check of `DES-BUILD-INPUT-CHECK` does not exist yet (nxr-agyqmz), so the post-check runs right after the call. Batches: nxr-pht7d6.
- `lockfile` is in `inferredTargetNames`, so `targetNames` renames it with the collision check. `nx add` writes the third empty entry.
- Mara: the executor in `DES-TARGETS`; the folder naming, the `directory:` dependency and the check before cargo in `DES-LOCKFILE-HASHING`; a `DES-DIAGNOSTICS` row; `VER-SETUP` and `VER-TARGET-DEFAULT-GUARD` updated for three entries and for the `"..."` that warning cases need; status notes of the targets, caching and CI pages updated.
- Tests: the local registry moved into the harness (`LocalRegistry`); `lockfile-keys.spec.ts` (16 real-hasher rows with the lockfile task, 2 checked by mutation), `lockfile-digest.spec.ts` (digest rules, folder names, flag parsing), `lockfile-runs.spec.ts` (the end-to-end paragraph of `VER-CACHE-KEYS` and the lockfile checks of `VER-TARGETS`/`VER-SETUP`, `nx affected` and `--exclude-task-dependencies` with and without the daemon); updated graph, executor, init, target-default and e2e specs.

Checks run: `pnpm nx run-many -t build lint` and `pnpm nx test nx-rust --maxWorkers=6` (786 tests, after merging main with #41 and #42, in place of `run-many -t build lint test`, as the machine requires), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` with Cargo 1.100.0 and with 1.91.0 (29 tests each), the lockfile specs with Cargo 1.91.0 too, `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `zban check`. CI on the pull request covers the rest.

Rejected: naming the workspace project by its name in `dependsOn` (a `project.json` or `package.json` can rename it); a folder per workspace named by its path (nested workspaces' folders would contain each other); writing digests for every path package (members alone are what targets read).
