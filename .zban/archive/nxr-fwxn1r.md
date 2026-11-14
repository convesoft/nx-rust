---
title: Settle how nx release publish --registry maps to Cargo
status: done
type: task
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-m8evx2
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:49:00Z
closed_at: 2026-11-14T18:22:48Z
---

Goal: `nx release publish --registry <value>` publishes crates to the registry the user means, or keeps failing with a clear reason.

Until this is settled, `DES-RELEASE` (`nx-rust/docs/release.mara.md`, Options and "Settled during implementation") fails a publish task that receives `registry`, because ignoring it would publish to another registry than the one asked for. Nx passes the flag's value through as given (`EVD-NX-24-RELEASE`); for npm it is a URL. Cargo takes a registry's name from its configuration with `--registry`, or an index URL with `--index`, and a crate's `publish` list and `registry.default` choose one as well (`EVD-CARGO-PUBLISH`: path dependencies are looked up on crates.io when packaged unless their entry names a `registry`).

- [x] Find with evidence what `nx release publish --registry` passes and what each Cargo form does with a name, a URL and a crate whose `publish` list names another registry
- [x] Ask the maintainer which mapping v1 offers: a name, a URL, either by its form, or none (keep failing)
- [x] Update `DES-RELEASE`, its user guidance and `VER-RELEASE` group 7, and file the implementation step on nxr-m8evx2 or its successor

Done when: the maintainer has chosen, the items are updated, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer chose on 14 November 2026 to keep failing, with guidance. `ADR-PUBLISH-REGISTRY-OPTION` records the choice word for word, with the two rejected mappings (a Cargo registry name; a name or a URL told apart by its form) and their reasons. **Options** in `DES-RELEASE` states the message, how it tells `nx release publish --registry` from configuration (the overrides in the task graph), what it says for a `targetDefaults` entry written for npm, Cargo's three ways, the `registry` key for dependencies and how npm packages alone get a registry, and what the task does with `dryRun`, `firstRelease`, `tag`, `access` and `otp`. The point left "Settled during implementation", and so did the one on how the executor learns the target registry.

The control plane's corrections from the same research are recorded as its decisions, of which the maintainer is told: **Where a dependency points** and the new check _Dependencies published elsewhere_ (the registry that a dependency's entry points to, which cargo writes into the published crate whatever the configuration says, must be the registry the dependency is published to, also for a dependency of the same call; corrected after a review, which found that a replacement of crates.io changes only where cargo resolves the entry); one call per workspace, release group and target registry, refining `ADR-BATCHED-PUBLISH`; **Target registry** (`CARGO_REGISTRY_DEFAULT`, otherwise a `cargo publish --dry-run --no-verify --locked` probe per workspace and `publish` value read from its first `Updating` line, run with a target and build directory of the plugin's own after the review found that it overwrites tracked files under `target/package`, then `--registry <name>` passed explicitly, crates.io looked up with `cargo info --index sparse+https://index.crates.io/`, never `--registry crates-io`, and a failure wherever the executor cannot tell); tokens per registry in **Credentials and tree** and the guide, with `cargo login` saving the token for the default registry; and the wrong statement about `@nx/js` in `EVD-NX-24-RELEASE`. `EVD-CARGO-PUBLISH-REGISTRIES` records the cargo experiments, repeated on Cargo 1.100.0 and 1.91.0 in a network namespace against local registries only, and `EVD-NX-24-PUBLISH-OPTIONS` records the research's Nx runs with the source lines read again. `REQ-RELEASE`, the user guide (new section Registries), four rows of `DES-DIAGNOSTICS`, and `VER-RELEASE` groups 6 to 8 (registry keys in the fixtures, no probe under the harness's pinned default) and a new group 9 (two local registries, environment and probe cases kept apart, `publish` lists that cargo can satisfy in one workspace, tracked files under `target/package`, the `registry` option from the command line and from `targetDefaults`, tokens, and the rule that no test passes `--registry crates-io`) follow. nxr-m8evx2 and nxr-k4c6ek now carry the matching tasks, among them what group 9 needs from the harness registry of nxr-52c1bx. nxr-amj7q7 takes the open question of publishing to crates.io while the configuration replaces it.

Rejected along the way: reading crates.io's replacement from the configuration files to count an entry without a `registry` key as the replacement's, which the review showed to be wrong because the published crate still names crates.io; taking a one-entry `publish` list as the target without asking cargo, because passing its entry would publish a crate that plain cargo refuses under a `registry.default` naming another registry; and letting the probe write into the checkout's target directory. After a second review the control plane put every registry question under one principle (**Registries** in `DES-RELEASE`): the plugin uploads only where cargo's own output establishes that each lookup asked the registry that the upload goes to, so a replaced named registry, two names for one index, one name for two indexes in two workspaces and an offline lookup fail before any upload; the maintainer's answer on nxr-amj7q7 is recorded in the same change.

Checks: `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`. No test run: specification only.
