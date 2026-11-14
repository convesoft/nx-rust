---
title: Select a crate whose package name another package in the resolve shares
status: todo
type: bug
parent: nxr-9y4eh8
discovered_from: nxr-gqad20
created_at: 2026-11-14T15:54:46Z
---

Goal: every cargo command that selects a crate works when a package outside the workspace has the same name as that crate.

Context: `DES-INVOCATION` (`nx-rust/docs/caching.mara.md`) addresses crates by their real package name and manifest path, and `cargoArguments` in `nx-rust/src/executors/command.ts` passes `-p <package name>`. Cargo keeps the package names of the members of one workspace distinct, but not the names across the whole resolve. An experiment for nxr-gqad20 (14 November 2026, cargo 1.100.0, recorded in `EVD-CARGO-BATCH-FAILURES`) had a member `good` 0.1.0 and a path dependency `good` 0.2.0 outside the workspace. There `cargo test --doc -p good` failed with "specification `good` is ambiguous" and listed `good@0.1.0` and `good@0.2.0`, while `-p good@0.1.0` worked. So `nx test good`, and every other target of that crate that selects it with `-p`, fails in such a workspace. A dependency from crates.io with the same name as a member is likely to do the same; that was not run. Cargo's list of failed targets still names the member by its bare name, as `-p good --doc`.

- [ ] Reproduce with the plugin, with a path dependency and with a registry dependency of the member's name
- [ ] Choose the package specification that is never ambiguous (for example `name@version`, or the spec that `cargo pkgid` prints for the manifest), record it in `DES-INVOCATION` and extend the check in `VER-TARGETS` or the verification that covers `DES-INVOCATION`
- [ ] Implement it for every command that selects crates, single tasks and batches alike

Done when: the checks pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
