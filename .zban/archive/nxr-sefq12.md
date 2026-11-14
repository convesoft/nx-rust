---
title: Select a crate whose package name another package in the resolve shares
status: done
type: bug
parent: nxr-9y4eh8
related:
  - nxr-s12cpg
discovered_from: nxr-gqad20
created_at: 2026-11-14T15:54:46Z
closed_at: 2026-11-14T16:39:23Z
---

Goal: every cargo command that selects a crate works when a package outside the workspace has the same name as that crate.

Context: `DES-INVOCATION` (`nx-rust/docs/caching.mara.md`) addresses crates by their real package name and manifest path, and `cargoArguments` in `nx-rust/src/executors/command.ts` passes `-p <package name>`. Cargo keeps the package names of the members of one workspace distinct, but not the names across the whole resolve. An experiment for nxr-gqad20 (14 November 2026, cargo 1.100.0, recorded in `EVD-CARGO-BATCH-FAILURES`) had a member `good` 0.1.0 and a path dependency `good` 0.2.0 outside the workspace. There `cargo test --doc -p good` failed with "specification `good` is ambiguous" and listed `good@0.1.0` and `good@0.2.0`, while `-p good@0.1.0` worked. So `nx test good`, and every other target of that crate that selects it with `-p`, fails in such a workspace. A dependency from crates.io with the same name as a member is likely to do the same; that was not run. Cargo's list of failed targets still names the member by its bare name, as `-p good --doc`.

- [x] Reproduce with the plugin, with a path dependency and with a registry dependency of the member's name
- [x] Choose the package specification that is never ambiguous (for example `name@version`, or the spec that `cargo pkgid` prints for the manifest), record it in `DES-INVOCATION` and extend the check in `VER-TARGETS` or the verification that covers `DES-INVOCATION`
- [x] Implement it for every command that selects crates, single tasks and batches alike

Done when: the checks pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Every per-crate command but `cargo fmt` now selects its crate with `-p` and the package ID specification that cargo reports for the member, as `cargo pkgid` prints it (`path+file://<folder>#<version>`, with `<name>@` before the version where the folder has another name). Before its command, a task asks `cargo metadata --format-version 1 --no-deps` in the workspace root with its own environment and without `--manifest-path` (`memberSpecs` in `nx-rust/src/cargo/package-specs.ts`) and takes the `id` of the member with the crate's name; `crateSelection` in `nx-rust/src/executors/command.ts` gives the arguments for one crate or several, which nxr-s12cpg now names for the batch executor. `fmt` and `fmt-check` keep the name, because `cargo fmt` rejects specifications and matches members only. A task fails before its command, with cargo's message, where cargo cannot give the report. The specification is computed when the task runs and reaches no graph, option, input, output or key.

Reproduced first with the plugin built from `main`, in a copy of the new fixture `shared-names`: with a path package `good` 0.2.0 that the member `good` 0.1.0 depends on, `build`, `check`, `lint`, `test`, `bench` and `run` failed as ambiguous; with a registry package `kit` 0.1.0 (a local directory registry) that the member `kit` 0.1.0 depends on, `build`, `check`, `lint` and `test` failed. `-p kit@0.1.0` is ambiguous too. After the change all of them passed, on cargo 1.100.0 and with 1.91.0. A bare name is ambiguous only where the packages that the selection reaches include the other package, so a batch with several `-p` hits it where a single task does not. Recorded in `EVD-CARGO-PACKAGE-SPECS`, `DES-INVOCATION` ("Selecting a crate"), `DES-TARGET-COMMANDS`, `DES-DIAGNOSTICS` (two rows), `DES-TEST-RUN`, `VER-CARGO-UNCHANGED`, `VER-TARGETS`, `VER-GRAPH` and the guidance of `caching.mara.md`, `targets.mara.md` and `workspaces.mara.md`.

Tests: `nx-rust/test/shared-names.spec.ts` (path case, registry case with a folder of another name, two checkouts with the same task hashes after their runs, the failing report), the fixture in `graph.spec.ts`, `fixtures.spec.ts` and the build input check's fixture loop, and the logged cargo arguments of the existing unit and end-to-end tests through one harness helper, `packageSpec`. With bare names forced in `crateSelection`, the three run tests of `shared-names.spec.ts` failed.

Checks run: `pnpm nx run-many -t build lint test` (37 suites, 1154 tests passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and again on 1.91.0 through a private `RUSTUP_HOME` (26 tests each), `shared-names.spec.ts` on 1.91.0, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no errors or warnings) and `zban check`, after merging `main` at ab99f3a.

Rejected: `name@version` (ambiguous with a registry package of the same version); `cargo pkgid` (needs `Cargo.lock`); building the specification in the plugin from the manifest path, or reading it from graph creation's report (a specification through a symbolic link matches nothing in the real folder, and the graph would hold absolute paths); the name with a fallback (the `--no-deps` report cannot show where a name is ambiguous). Not tested: the message for a member that is missing from the report, which needs a stale graph. Filed nxr-8qb0eb for a task whose own environment selects a Cargo older than 1.91.
