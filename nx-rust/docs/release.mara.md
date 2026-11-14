# Releasing

> **Status:** specified, not implemented yet. Planned for milestone 0.5.
> Publishing rests on the batching of milestone 0.2.

A repository that versions and publishes its JS packages with
[Nx release](https://nx.dev/features/manage-releases) releases its crates
through the same commands:

```sh
nx release                     # versions, changelogs, commit and tag, then asks whether to publish
nx release --yes               # the same, and publishes without asking
nx release publish --dry-run   # check what publishing the committed versions would upload
```

Nx release keeps doing what it does for JS packages: it works out the bumps
from conventional commits or version plans, writes changelogs, and makes the
git commit and tag. The plugin teaches it `Cargo.toml`, `Cargo.lock` and
`cargo publish`.

## Setting it up

Release configuration lives in `nx.json`, and in a crate folder's
`project.json` where one exists, as for JS packages; the plugin's tables in
`Cargo.toml` hold none. Each crate's project already names the plugin's
version actions, so `nx.json` needs no `versionActions`, and a repository with
only Rust needs no `@nx/js`.

```json
{
  "release": {
    "groups": {
      "crates": {
        "projects": ["core", "api", "cli"],
        "projectsRelationship": "fixed"
      }
    },
    "git": { "commit": true, "tag": true }
  }
}
```

- Cargo publishes committed files only. `nx release` commits and tags by
  default, but `nx release version` on its own only stages its changes. To run
  the subcommands one after another, set `release.git` as above, so that
  `nx release version` commits and tags before `nx release publish` runs.
- Crates that inherit `version.workspace = true` share one version. Put all of
  them into one release group with `"projectsRelationship": "fixed"`;
  otherwise `nx release version` stops before it writes anything and names
  them.
- Leave the workspace project of a virtual manifest, such as `rust` or
  `cargo-workspace`, out of the release projects. It has no version.
- Publishing needs Cargo 1.91 or later, which the plugin requires anyway.

## Versioning

`nx release version` reads each crate's current version from its `Cargo.toml`,
following `[workspace.package]` where the crate inherits it, and writes the
new one back:

| What                                                                                     | What happens                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A crate with its own `version`                                                           | The new version is written to its `[package]` table                                                                             |
| Crates with `version.workspace = true`                                                   | One version, written once to `[workspace.package].version`                                                                      |
| A crate that depends on a bumped crate, as a normal or build dependency with a `version` | It is bumped as well, by a patch by default (Nx's `updateDependents`), because its published crate names the new version        |
| A dev-dependency on a bumped crate                                                       | No bump: the crates that use a crate never build its dev-dependencies                                                           |
| A path dependency without `version` on a bumped crate                                    | No bump: cargo leaves such a dev-dependency out when it publishes, and refuses to publish a crate with such a normal dependency |
| Any version requirement on a bumped crate in the repository's Cargo workspaces           | Updated, also in `[workspace.dependencies]` and in crates that are not released, so that every workspace still resolves         |
| `Cargo.lock`                                                                             | `cargo update --workspace` in each workspace whose manifests changed; no other locked package moves, and Nx commits it          |

A requirement is updated like this:

| Requirement            | New version | Result                                                                          |
| ---------------------- | ----------- | ------------------------------------------------------------------------------- |
| `0.1.0`, `^0.1`        | 0.1.4       | Kept: it still matches (Nx's `preserveMatchingDependencyRanges`, on by default) |
| `0.1.0`                | 0.2.0       | `0.2.0`                                                                         |
| `^0.1`                 | 0.2.0       | `^0.2.0`                                                                        |
| `~0.1.0`               | 0.2.0       | `~0.2.0`                                                                        |
| `=0.1.0`               | 0.1.4       | `=0.1.4`                                                                        |
| `>=0.1, <0.2`, `0.1.*` | 0.1.4       | Kept, also with `preserveMatchingDependencyRanges` off; the output names it     |
| `>=0.1, <0.2`, `0.1.*` | 0.2.0       | Versioning stops before it writes anything, naming the manifest                 |

Only the version strings change. Comments and layout of the manifests stay as
they are, and Nx's formatter leaves the manifests alone. `git-tag` works as the
current-version resolver as Nx provides it; `registry` is not supported.

## Publishing

`nx release publish` runs the target `nx-release-publish`, which every crate
without `publish = false` has, apart from a cargo-hakari hack crate. Nx release
runs that name only, so `targetNames` cannot rename it.

```text
nx release publish
  core:nx-release-publish  ┐
  api:nx-release-publish   ├─ rust/             ->  cargo publish --locked -p core -p api -p cli
  cli:nx-release-publish   ┘
  xtask:nx-release-publish ── tools/xtask/      ->  cargo publish --locked -p xtask
```

- Each Cargo workspace of a release group is one `cargo publish` call. Cargo
  orders the crates of a call, checks every one of them before it uploads any,
  and waits for each upload to show in the registry's index. Calls run with a
  dependency's workspace first, and Nx runs release groups with a
  dependency's group first.
- Before each call, the plugin checks every crate of the repository that a
  crate of the call needs as a normal or build dependency and that the call
  does not publish itself: its version must be in the registry already.
  Otherwise the crate's task fails before anything is uploaded and says which
  dependency to publish first. Cargo alone would upload the crate against an
  older version of the dependency that its requirement still accepts.
- A version that the registry already has is left out with a message, so a
  second run after a partial publish publishes the rest.
- Every call passes `--locked`, so publishing never changes a tracked file. A
  stale `Cargo.lock` stops the task before anything is uploaded; run
  `nx release version`, which brings it up to date.
- The plugin passes no token: cargo uses its own credentials, from
  `cargo login` or `CARGO_REGISTRY_TOKEN`. It never passes `--allow-dirty`:
  with uncommitted changes, staged ones too, cargo refuses to publish, and the
  task's output says to commit the versions first.
- Nx's `--tag`, `--access` and `--otp` are npm's: a task ignores them with a
  line. `--registry` stops the task for now, because how it maps to Cargo's
  registries is not settled yet.

### What a dry run shows

`nx release publish --dry-run` packages and checks each crate as cargo would
upload it, uploads nothing and changes no file. Within one cargo call, cargo
checks a crate against the new versions of the other crates of the call. It
cannot do that across calls: a crate whose dependency's new version another
call would publish, for a crate of another Cargo workspace or of another
release group, is not handed to cargo. Its task succeeds and says that the
crate was not checked, naming the dependency, its version and the task that
would publish it. A dry run proves neither what crates.io itself checks on
upload nor how fast its index is.

A dry run of `nx release version` or of `nx release` writes no versions, so
check publishing with `nx release publish --dry-run` after the new versions
are committed.

### Dependencies that are not published

A crate that depends, with a version requirement, on a crate of the
repository that is not published to the registry, through `publish = false`
or a `publish` list without that registry, cannot be published as it is:
cargo packages the dependency for the registry, where it fails to resolve or
resolves to an unrelated crate of the same name. Publishing such a crate stops
before cargo runs and names both crates.

The plugin never publishes a cargo-hakari hack crate. For a crate that depends
on one with `publish = false`, the message adds the two ways that
[cargo-hakari](https://docs.rs/cargo-hakari) offers: publish a stub of the
hack crate once under a name of your own, after which your crates publish
normally, or publish such a crate with `cargo hakari publish` outside Nx.

## What is not part of it

- Publishing the napi and wasm packages to npm ([[ADR-V1-SCOPE]]).
- Reading current versions from the registry.
- Installing cargo-hakari, cargo-edit or any other tool.

## Requirements

:::mara requirement REQ-RELEASE
:mid: 01M78FHG7F358GRCJTK5Y6AQMR
:title: Version and publish crates through Nx release
:status: accepted
:satisfies: NEED-RELEASE

`nx release version` versions crates in their `Cargo.toml`. It bumps a crate's version, also one that the crate inherits from `[workspace.package]`, and bumps the crates that depend on a bumped crate through a normal or build dependency with a version requirement. Crates that share an inherited version are versioned together, and a configuration that would version them apart fails before anything is written. It updates every version requirement on a bumped crate in the repository's Cargo workspaces, in `[workspace.dependencies]` and in crates outside the release too, so that each workspace still resolves, and it brings the `Cargo.lock` of each workspace whose manifests changed up to date without moving any other locked package.

`nx release publish` publishes the selected crates with `cargo publish`. It never uploads a crate while a crate of the repository that it needs as a normal or build dependency lacks its version in the registry: such a crate, unless the same cargo call publishes the dependency, fails before anything is uploaded and says which dependency to publish first. It leaves out a crate whose version the registry already has, never publishes a crate with `publish = false` or a [[TERM-HACK-CRATE]], and fails before anything is uploaded for a crate that depends, with a version requirement, on a crate of the repository that is not published to that registry, saying why and, for a hack crate, how such a crate can be published. Publishing changes no tracked file.

A dry run of `nx release version` writes nothing, and a dry run of `nx release publish` uploads nothing and changes no file. The dry run of `nx release publish` checks each crate that would be published against the registry and against the new versions of the other crates of its cargo call, and reports each crate that it could not check because another call would publish the new version of one of its dependencies. Publishing napi and wasm packages to npm is not part of it ([[ADR-V1-SCOPE]]).
:::

## Design

:::mara design DES-RELEASE
:mid: 01M78FHG7F65ZV4NB8NPNJGH1T
:title: Release flow
:status: accepted
:satisfies: REQ-RELEASE

Nx release works out the bumps, walks dependents, writes changelogs and makes the commit, tag and push itself. The plugin adds the version actions for `Cargo.toml`, the lockfile step, the target `nx-release-publish` with its executor, and the checks before each publish call ([[EVD-NX-24-RELEASE]]). The maintainer chose the four answers that had real alternatives on 14 November 2026: one `cargo publish` per workspace ([[ADR-BATCHED-PUBLISH]]), one fixed release group for an inherited version, dependents from the manifests with requirements rewritten everywhere ([[ADR-RELEASE-DEPENDENTS]]), and an early failure for the hack crate. The control plane of the work settled the rest the same day from the measured facts ([[EVD-CARGO-PUBLISH]]): how requirements are rewritten, the lockfile step, and that npm publishing of napi and wasm packages stays out ([[ADR-V1-SCOPE]]). After a review of this design, the control plane decided the same day, and the maintainer is told: the check that a dependency's version is in the registry before a crate is uploaded, the dry run's limit across cargo calls, `--locked` on every publish call, what happens to a compound requirement that still matches, and the early failure for every dependency that is not published, which extends the maintainer's answer for the hack crate.

**Registration.** Each crate's project carries `release.version.versionActions`, naming the plugin's version actions, which `createNodes` sets as Nx allows for a project's `release.version`, so neither `nx.json` nor `@nx/js` is needed for them. The workspace project of a root manifest without a `[package]` table carries none: it has no version, and the user leaves it out of the release projects. The version actions find a project's crate through its `metadata.cargo`, the package name and manifest ([[DES-PROJECT-GRAPH]]), because the Nx name can differ from the package name.

**Current version.** The version actions read the current version from the crate's manifest, following `[workspace.package].version` where the crate inherits it, which is what Nx's default `disk` resolver asks for. `git-tag` works as Nx provides it. The `registry` resolver is not supported in v1: the version actions report no version from a registry, and Nx's error says so. A crate in the release whose manifest has no `version`, which cargo reports as 0.0.0, fails versioning with a message that names the manifest.

**Inherited versions.** Crates of one Cargo workspace that inherit `version.workspace = true` share one version. They are versioned together or not at all: they must be in one fixed release group, and a release configuration that puts them into different groups, or a run that would version some of them and not others, fails before anything is written, with a message that names the crates and the groups. The version is written once, to `[workspace.package].version`. The maintainer's option, word for word: "Require one fixed release group (Recommended)". Rejected: independent groups that silently move every crate inheriting the version, whose versions would then change without Nx's tags and changelogs; and no support for inherited versions, as in `@monodon/rust` 3.0.0, which blocks a common layout ([[EVD-NX-24-RELEASE]]). The rule binds only crates that share an inherited version: a crate with a version of its own can be in another release group than a crate it depends on.

**Dependents.** The version actions read a crate's dependencies from its workspace's `cargo metadata --no-deps` report ([[DES-METADATA-REPORT]]), not from the project graph, whose `implicit` edges are a superset kept for the cache key ([[ADR-RELEASE-DEPENDENTS]]). Nx release takes dependents only from what the version actions report ([[EVD-NX-24-RELEASE]]). A dependency makes the crate a dependent of the crate it names when it names, by path, a crate with an Nx project, is of kind normal or build, and carries a version requirement, in its own entry or in the `[workspace.dependencies]` entry it inherits. The report gives the requirement `*` both for an entry without a version requirement and for the requirement `*` written out ([[EVD-CARGO-PUBLISH]]), so the version actions read the manifest to tell the two apart. Optional, renamed and target-specific dependencies count. The path identifies the crate at the real path of its folder, as in [[DES-PROJECT-GRAPH]], and a crate of another workspace is found in that workspace's report. Dev-dependencies make no dependent, by the maintainer's choice: the crates that use a crate never build its dev-dependencies, although cargo keeps a dev-dependency with a version requirement in the published manifest. Dependencies without a version requirement make no dependent either: cargo leaves such a dev-dependency out of the published crate and refuses to publish a crate with such a normal dependency ([[EVD-CARGO-PUBLISH]]). Under Nx's default `updateDependents`, each dependent gets a patch bump.

**Requirements.** When a crate's version changes, every version requirement on it, matched by path, is updated in every manifest of the repository's Cargo workspaces that the plugin reads: in each member's dependency tables of every kind and their `[target.*]` forms, whether the member is released or not and whether it has an Nx project or not, and in each root manifest's `[workspace.dependencies]`. A dependency that inherits its entry with `workspace = true` is updated where the requirement is written, in `[workspace.dependencies]`. Manifests outside the repository are not written. A requirement that the new version satisfies is kept while Nx's `preserveMatchingDependencyRanges` is on, its default. With it off, a bare, `^`, `~` or `=` requirement is rewritten to the new version. Any requirement that the new version leaves is rewritten to the new version with its operator kept, where it has one of these forms. A requirement of another form, such as a comparison or a wildcard, is kept unchanged as long as the new version satisfies it, also with `preserveMatchingDependencyRanges` off, and the output says so, naming the manifest and the requirement: the plugin rewrites only the forms that it can rewrite without inventing bounds, and a requirement that still matches needs no change to stay correct. Such a requirement that the new version leaves fails versioning before Nx writes any file, with a message that names the manifest, the dependency and the requirement. The control plane decided the case of a matching compound requirement on 14 November 2026 after the review. Only version strings change in a manifest, so comments and layout stay byte for byte, and the version actions exclude the manifests from Nx's formatting pass. Failing on every requirement that the new version leaves, as `@nx/js` does for npm ranges, was not taken: every Cargo requirement is a range, so it would block every breaking release ([[EVD-NX-24-RELEASE]]).

**Lockfile.** The version actions module exports `afterAllProjectsVersioned`, which Nx calls once after it has written the manifests and before it commits. It runs `cargo update --workspace` in the root folder of each Cargo workspace whose manifests the run changed ([[DES-INVOCATION]]). It runs online, because `--offline` fails with an empty Cargo home as on CI, and never with `--locked`, also in locked mode, because the lockfile has to change, as for the `update` target ([[DES-WORKSPACE-TARGETS]]). Cargo then changes the bumped members' entries and the references in other entries' dependency lists that spell out a version or a source, and moves no other locked package ([[EVD-CARGO-PUBLISH]]). The function returns the lockfiles that cargo changed and that git does not ignore, which Nx stages, and commits with the manifests where `release.git` asks for a commit or the command is `nx release` ([[EVD-NX-24-RELEASE]]). When cargo fails, the release fails with a message that names the workspace and carries cargo's message, and Nx makes no commit. In a dry run it runs nothing, because Nx has written no manifest. Release may write the lockfile ([[REQ-NO-MANIFEST-WRITES]], [[ADR-V1-SCOPE]]). `@monodon/rust` 3.0.0 runs the update in the Nx root only and swallows its failures ([[EVD-NX-24-RELEASE]]); a workspace elsewhere would keep a stale lockfile.

**Publish target.** Every crate without `publish = false`, other than the hack crate, has the target `nx-release-publish`. Nx release runs that name only ([[EVD-NX-24-RELEASE]]), so `targetNames` does not apply to it ([[DES-TARGETS]], [[DES-PLUGIN-OPTIONS]]). The target is not cached ([[DES-OUTPUTS]]) and has no `dependsOn` ([[REQ-NO-RUST-TASK-DEPS]]). It runs the executor `@convesoft/nx-rust:release-publish`, which declares a batch implementation and `preferBatch: true` ([[ADR-BATCH-EXECUTOR]], [[ADR-BATCHED-PUBLISH]]).

**Batch.** `nx release publish` runs one release group after another, in the order of the dependencies that the version actions report, so a batch holds the runnable `nx-release-publish` tasks of one group ([[EVD-NX-24-RELEASE]]). The batch implementation runs one `cargo publish --locked` per Cargo workspace, started in the workspace root, with a `-p` and the real package name for each crate of its tasks that the checks below leave in ([[DES-INVOCATION]]). Cargo orders those crates, packages and verifies each against the others before it uploads any, waits after each upload until the registry's index lists it, and stops rather than publish a crate after the wait for one it depends on has timed out ([[EVD-CARGO-PUBLISH]]). The calls of different workspaces run one after another, a workspace after those whose crates its crates depend on with a version requirement, so that a dependency is in the registry when the call of its dependents is checked. Where such dependencies form a cycle between workspaces, no order satisfies cargo, and the checks or cargo fail the call that cannot resolve. Cargo's output is mapped to one result per task: a task succeeds when cargo uploaded its crate, or in a dry run verified it, and fails otherwise. The batch reports a result for every task it receives, also for one that it does not hand to cargo, because Nx starts a new batch without end for a task left out, and it does not throw, because a throw fails every task of the batch ([[EVD-NX-24-BATCHES]]). Known limit: Nx orders release groups by the reported dependencies, which leave out dev-dependencies, so a crate whose dev-dependency with a version requirement is published in a later group fails verification with cargo's message, and a second run publishes it.

**Checks before each call.** Before each `cargo publish`, with or without a batch, the executor checks each crate that the call would publish, in this order:

- _Unpublished dependencies._ A normal or build dependency with a version requirement on a crate of the repository that is not published to the registry of the call, through `publish = false` or a `publish` list without that registry, fails the crate's task. Cargo packages such a dependency for the registry whatever the dependency's `publish` says: it fails to resolve where the registry has no crate of that name, and it resolves to an unrelated crate where the registry has one, which cargo then publishes as the dependency ([[EVD-CARGO-PUBLISH]]). The message names the crate and the dependency and says that the dependency has to be published to that registry or stop being a normal or build dependency; for a hack crate it adds cargo-hakari's ways (**Hack crate**). The control plane extended the maintainer's answer for the hack crate to every such dependency on 14 November 2026, as its consequence. A dependency without a version requirement is left to cargo, which refused a crate with such a normal dependency before it uploaded anything of its call ([[EVD-CARGO-PUBLISH]]).
- _Dependencies published first._ For every other normal or build dependency with a version requirement on a crate of the repository, other than one that the same call publishes, the dependency's version in its manifest must already be in the registry of the call. Otherwise the crate's task fails before any upload, with a message that names the dependency, its version and the crate that needs it, and says to publish the dependency first: in the same `nx release publish`, which publishes a dependency's workspace and release group first, or by running the dependency's task before this one. This holds across workspaces and release groups. Cargo would otherwise upload the crate against any registry version that its requirement accepts: with `a` 0.1.0 in the registry and `a` bumped to 0.1.1 beside `b`, whose requirement `0.1.0` still matched, `cargo publish -p b` uploaded `b` built against `a` 0.1.0, and `a` 0.1.1 was never uploaded ([[EVD-CARGO-PUBLISH]]). The control plane chose a check over a narrower promise because an upload cannot be undone. In the normal flow the check passes: cargo waits after each upload until the index lists it, for up to 60 seconds, and right after a call had published a crate, the lookup below found its version ([[EVD-CARGO-PUBLISH]]). Where the index is slower than that, the check fails the dependent before any upload, and a second run publishes it.

A crate whose task fails a check is left out of the call, and so is each crate of the call that depends on a crate left out, whose task fails with a message that names that crate; the rest of the call runs. The executor asks the registry with `cargo info <name>@<version> --registry <registry> --locked`, started in the workspace root. With a full version cargo matches it exactly; it exits with 0 where the registry has the version and with 101 and "could not find `<name>@<version>`" where it does not. `--registry` makes cargo ask the registry instead of describing the workspace's own crate of that name, which cargo 1.100 does without it, and `--locked` keeps cargo from rewriting a stale `Cargo.lock`, which it does without it ([[EVD-CARGO-PUBLISH]]). Any other failure, such as an unreachable registry, fails the task with cargo's message. The executor never passes `--offline`: offline with an empty Cargo home, cargo gives the same message for a version that the registry has.

**Dry run.** With `--dry-run`, the executor passes `--dry-run`, and cargo verifies the crates of a call without uploading, each against the registry and against the new versions of the other crates of the same call. That overlay does not carry from one call to the next: after the dry run of a crate's call, the dry run of a dependent's call in another workspace failed with "no matching package named" ([[EVD-CARGO-PUBLISH]]). In a dry run, a crate whose dependency fails only the check _Dependencies published first_, because another call would publish it, is therefore not handed to cargo, and neither is a crate of its call that depends on it. Its task succeeds and says that the crate was not verified, naming the dependency, its version and the task that would publish it, `<project>:nx-release-publish`. The other crates of the call are verified. This happens across Cargo workspaces and across release groups, which the rule for inherited versions does not prevent. A dependency that no task would publish, or that is not published to the registry, fails as in a real run. The control plane decided this limit on 14 November 2026 after the review; a real run is covered by the checks.

**Existing versions.** Nx runs the target on every crate of a group, bumped or not, and cargo fails a whole multi-crate call before uploading anything when one selected version already exists ([[EVD-CARGO-PUBLISH]]). The executor therefore asks the registry, with the lookup above, for each crate of the call, leaves out each crate whose version the registry already has, and its task succeeds with a message that names the crate and the version, so a second run after a partial publish publishes the rest.

**Tracked files.** Every `cargo publish` and `cargo info` that the executor runs passes `--locked`, whatever the plugin's `locked` option says ([[DES-INVOCATION]]), so publishing never changes a tracked file, in a dry run or a real one. Without it, a dry run with a committed bump beside a stale `Cargo.lock` rewrote the lockfile ([[EVD-CARGO-PUBLISH]]). With it, a stale lockfile fails the call before any upload, with cargo's message, which differs between Cargo versions, and the executor adds that `nx release version` brings the lockfile up to date (**Lockfile**). After that step the multi-crate call with `--locked` succeeds, as a dry run and as a real one ([[EVD-CARGO-PUBLISH]]). The control plane decided this on 14 November 2026 after the review.

**Credentials and tree.** The executor passes no token: cargo takes its credentials from its own configuration and `CARGO_REGISTRY_TOKEN`, as plain `cargo publish` does. It never passes `--allow-dirty`, so cargo refuses to publish uncommitted changes, staged ones too ([[EVD-CARGO-PUBLISH]]); the task then fails with cargo's message and a line that says to commit the new versions first. `nx release` commits and tags by default, while `nx release version` on its own only stages its changes unless `release.git` asks for a commit ([[EVD-NX-24-RELEASE]]). Cargo's `registry.default` and a crate's `publish` list apply as with plain cargo.

**Options.** The executor's schema declares the options that `nx release publish` passes and that it uses or accepts ([[EVD-NX-24-RELEASE]]): `dryRun`, which passes `--dry-run`; `registry`; and `firstRelease` and `nxReleaseVersionData`, which change nothing. A task with `registry` fails before cargo runs, with a message that names the option, until its mapping to Cargo is settled (**Settled during implementation**): ignored, it would publish to another registry than the one asked for. `tag`, `access` and `otp` are npm's: the schema does not declare them, and a task ignores them with a line ([[DES-UNKNOWN-OPTIONS]]).

**Without a batch.** `nx run <project>:nx-release-publish` gives a batch of that one task ([[EVD-NX-24-BATCHES]]). When Nx runs a publish task outside a batch, as with `--batch=false` or `NX_BATCH_MODE=false`, the task runs the same checks and `cargo publish --locked -p <crate>` for its own crate. A crate that needs another crate of the repository then passes the check _Dependencies published first_ only once that crate's new version is in the registry; the tasks run in no set order, because the target has no `dependsOn`, so such a task can fail before any upload, and a second run publishes it.

**Hack crate.** In a workspace with a cargo-hakari configuration, the hack crate is the package that its `hakari-package` names, in `.config/hakari.toml` as `cargo hakari init` writes it ([[EVD-HAKARI-UNIFICATION]]). The plugin never publishes it: it has no `nx-release-publish`. When the hack crate has `publish = false`, the check _Unpublished dependencies_ fails each crate that depends on it, and the message points to cargo-hakari's two ways: a stub of the hack crate published once under a unique name, after which plain `cargo publish` works, and `cargo hakari publish` for one crate at a time, outside Nx. On crates.io, a requirement on the common name `workspace-hack` resolves to an unrelated crate ([[EVD-CARGO-PUBLISH]]). Where the hack crate does not set `publish = false`, as such a published stub does, its dependents publish normally once the stub's version is in the registry. The maintainer's option, word for word: "Fail early with guidance (Recommended)". Rejected: running `cargo hakari publish` for each crate, which needs cargo-hakari installed ([[ADR-V1-SCOPE]]) and loses the multi-crate dry run and cargo's stop after a timeout; and taking the dependency out of the manifest around the cargo call, which writes manifests for a moment, needs `--allow-dirty` and leaves them changed when interrupted.

**Other milestones.** Publishing rests on the batch executor of milestone 0.2 ([[ADR-BATCH-EXECUTOR]], [[DES-BATCH]]) and on what Nx does with a batch: on Nx 24.0.6 each task of a batch keeps its own result and terminal output ([[EVD-NX-24-BATCHES]], [[RISK-BATCH-BEHAVIOUR]]). Per-task results from a batch matter here; per-task caching does not, because the target is not cached. The hack crate is recognised through the cargo-hakari configuration that the `hakari` strategy of milestone 0.2 detects ([[DES-UNIFICATION]]).

**Settled during implementation.** These points do not change what the paragraphs above promise. The implementation work settles each with evidence and records it here:

- How the version actions edit a manifest so that only version strings change. The plugin's TOML parser keeps no layout when it writes.
- How the executor learns the name of the registry that cargo publishes a call to, for the checks and the lookup: cargo chooses it from `registry.default` and a crate's `publish` list.
- How Nx's `--registry` maps to Cargo: to a registry name from Cargo's configuration, or to an index URL.
- What cargo-hakari writes beyond the configuration file that names the hack crate ([[EVD-HAKARI-UNIFICATION]]): the forms of the members' dependency on the hack crate in each dep-format version, and whether the crate it generates sets `publish = false`.
- Whether Nx 24 drives the version actions and the batch as [[EVD-NX-24-RELEASE]] reads it ([[RISK-NX-RELEASE]]).
:::
