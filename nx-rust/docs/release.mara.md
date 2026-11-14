# Releasing

> **Status:** partly implemented, for milestone 0.5. `nx release version`
> versions crates as [Versioning](#versioning) describes, apart from the update
> of `Cargo.lock`. Not implemented yet: that update, the target
> `nx-release-publish` and everything under [Publishing](#publishing), its
> registries included, which rests on the batching of milestone 0.2.

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
  default, with the settings of `release.git`. `nx release version` on its own
  only stages its changes, and refuses a root `release.git`. To run the
  subcommands one after another, have it commit and tag with
  `nx release version --git-commit --git-tag --stage-changes`, or set
  `release.version.git` in place of `release.git`, which `nx release` refuses
  in turn.
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
| `Cargo.lock` (not implemented yet)                                                       | `cargo update --workspace` in each workspace whose manifests changed; no other locked package moves, and Nx commits it          |

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
Where `preserveMatchingDependencyRanges` differs between crates, the setting of
the crate whose manifest holds the requirement counts, and for a crate outside
the release and in `[workspace.dependencies]` that of the crate whose version
changes. `versionPrefix` and `manifestRootsToUpdate` have no effect.

Besides the dependency tables, versioning keeps these places in step with a
crate's new version, or stops before it writes anything:

| Place that names a bumped crate                                                                                          | What happens                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `[patch.<source>]` entry with `path` and `version`, in a root manifest                                                   | The requirement is updated by the rules above; it makes no crate a dependent                                                   |
| The same in a `.cargo/config.toml` that cargo reads, inside the repository                                               | The same                                                                                                                       |
| The same in a Cargo configuration outside the repository, such as the Cargo home's                                       | Kept where it still matches; otherwise versioning stops, naming the file                                                       |
| `[replace]` entry whose `path` names the crate                                                                           | Versioning stops: cargo takes a replacement only with the version it replaces; use `[patch]`                                   |
| A registry requirement that a `[patch]` redirects to the crate, by `crates-io`, a registry's name or an index or git URL | Kept where the new version still matches it; otherwise versioning stops, because cargo would quietly take the registry's crate |
| `[profile.<name>.package."<crate>@<version>"]`, also by `file://` URL                                                    | Versioning stops where the new version leaves it; write the table without the version                                          |

Nx decides two kinds of bump across release groups by itself, which show only
where groups take their bumps from conventional commits or version plans: a
specifier on the command line, as in `nx release version minor`, applies to
every crate of the run.

- A fixed group that gets no bump of its own is bumped when a crate of it has an
  edge in the project graph to a crate of a group that Nx bumped before it,
  also through a dev-dependency, because the plugin's edges include those. The
  run goes on, and its output names the group, the edge and what it is in
  Cargo. This is a known limit of Nx release.
- A crate in an independent group that depends on a crate of a fixed group is
  not bumped when Nx bumps that group, unless its own group bumps it. Its
  requirement would change without a new version, so versioning stops before
  it writes anything and names the crate: release it in the same run, with a
  version plan or a conventional commit of its own. The same holds for any crate
  in the release whose requirement would change without a bump, as under
  `updateDependents: "never"`.

Every check runs before the first file is written, also one that each file to
be changed is writable and lies inside the repository once symbolic links are
followed: a `.cargo/config.toml` or a member's folder that links outside stops
versioning, naming where it leads. A failure while Nx writes the files, which no check
foresees, such as a full disk, can leave manifests changed and unstaged:
`git checkout` undoes them.

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

- Each Cargo workspace of a release group is one `cargo publish` call, or one
  per registry where its crates go to different registries. Cargo orders the
  crates of a call, checks every one of them before it uploads any, and waits
  for each upload to show in the registry's index. Calls run with a
  dependency's call first, and Nx runs release groups with a dependency's
  group first.
- Before each call, the plugin checks every crate of the repository that a
  crate of the call needs as a normal or build dependency and that the call
  does not publish itself: its version must be in the registry that the
  dependency's entry points to already. Otherwise the crate's task fails before anything is
  uploaded and says which dependency to publish first. Cargo alone would
  upload the crate against an older version of the dependency that its
  requirement still accepts.
- A version that the registry already has is left out with a message, so a
  second run after a partial publish publishes the rest.
- Every call passes `--locked`, so publishing changes no tracked file outside
  Cargo's build directory, by default `target`, where cargo writes the
  packaged crates as plain `cargo publish` does; don't keep files there that
  git tracks. A stale `Cargo.lock` stops the task before anything is uploaded;
  run `nx release version`, which brings it up to date.
- The plugin passes no token: cargo uses its own credentials for the registry
  it publishes to ([Registries](#registries)). It never passes
  `--allow-dirty`: with uncommitted changes, staged ones too, cargo refuses to
  publish, and the task's output says to commit the versions first.
- Nx's `--tag`, `--access` and `--otp` are npm's: a task ignores them with a
  line. `--registry` stops each crate's task before cargo runs
  ([Registries](#registries)).

### Registries

Cargo chooses where a crate goes, as plain `cargo publish` does. Before each
call the plugin asks cargo which registry that is, and then names it to cargo,
so that its checks look where cargo uploads.

| Setting                                                                                                | Where the crate goes                                                    |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `CARGO_REGISTRY_DEFAULT=my-registry` in the environment, or `registry.default` in `.cargo/config.toml` | There; a crate whose `publish` list leaves that registry out is refused |
| `publish = ["my-registry"]` in the crate's `Cargo.toml`, and no default                                | `my-registry`                                                           |
| None of these                                                                                          | crates.io                                                               |

Tokens come from cargo's credentials too. For a registry other than
crates.io, use `cargo login --registry my-registry`,
`CARGO_REGISTRIES_MY_REGISTRY_TOKEN` or a credential provider.
`CARGO_REGISTRY_TOKEN` holds crates.io's token only. Plain `cargo login` saves
the token for the registry that `registry.default` names, and for crates.io
only where none is named.

Each entry of a dependency on another crate of the repository that is
published elsewhere than crates.io has to name that registry, in
`[workspace.dependencies]` where the entry inherits it:

```toml
[dependencies]
core = { path = "../core", version = "0.3.0", registry = "my-registry" }
```

Without the key, the published crate depends on crates.io's crate of that
name, whatever registry both crates go to, also where your Cargo
configuration puts that registry in place of crates.io: a replacement changes
where cargo looks on your machine, not what it writes into the crate. The
plugin stops such a crate before anything is uploaded and names the entry to
change. Cargo refuses a manifest whose `registry` key names no configured
registry, so configure the registry wherever the workspace is built.

The plugin publishes a crate only where cargo's own output shows that the
checks before the upload asked the registry that the upload goes to.
Otherwise it stops the crate, and the crates that depend on it, before
anything is uploaded, and says what it could not tell. Configure Cargo
plainly:

- One name for each registry, and the same name in every Cargo workspace.
- No source replacement for the registry you publish to. On a machine whose
  configuration replaces crates.io, such as with a mirror, publish to
  crates.io from a job whose configuration does not.
- Where a crate depends on a crate of another Cargo workspace of the
  repository on a registry other than crates.io, give that registry's index
  in the environment, as `CARGO_REGISTRIES_MY_REGISTRY_INDEX`, so that it is
  the same for every workspace.
- Publish online: offline, cargo does not say which registry it asked, and
  it refuses to publish anyway.

`nx release publish --registry` is npm's flag: Nx hands the same value, for
npm a URL, to every publish task, and cargo needs the name of a registry from
its configuration. A crate's task that receives it stops before cargo runs and
says how to choose the registry instead; so does a `registry` from a
`project.json` or from a `targetDefaults` entry. To publish to another
registry for one run, set the variable instead:

```sh
CARGO_REGISTRY_DEFAULT=my-registry nx release publish
```

In a repository that also publishes npm packages, give the registry to those
alone: publish them in a run of their own, such as
`nx release publish --groups npm-packages --registry https://npm.example.com/`,
set it in `.npmrc`, or put it in a `targetDefaults` entry keyed by
`@nx/js:release-publish`, which reaches npm packages only. An entry keyed by
`nx-release-publish` reaches crates as well, unless `nx.json` has the empty
entry keyed by `@convesoft/nx-rust:release-publish` that `init` adds.

### What a dry run shows

`nx release publish --dry-run` packages and checks each crate as cargo would
upload it, uploads nothing and changes no tracked file outside Cargo's build
directory. Within one cargo call, cargo
checks a crate against the new versions of the other crates of the call. It
cannot do that across calls: a crate whose dependency's new version another
call would publish, for a crate of another Cargo workspace, registry or
release group, is not handed to cargo. Its task succeeds and says that the
crate was not checked, naming the dependency, its version and the task that
would publish it. A dry run proves neither what crates.io itself checks on
upload nor how fast its index is.

A dry run of `nx release version` or of `nx release` writes no versions, so
check publishing with `nx release publish --dry-run` after the new versions
are committed.

### Dependencies that are not published

A crate that depends, with a version requirement, on a crate of the
repository that is not published to the registry that the dependency's entry
points to, through `publish = false` or a `publish` list without that registry, cannot be
published as it is: cargo packages the dependency for that registry, where it
fails to resolve or resolves to an unrelated crate of the same name.
Publishing such a crate stops before cargo runs and names both crates.

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

`nx release version` versions crates in their `Cargo.toml`. It bumps a crate's version, also one that the crate inherits from `[workspace.package]`, and bumps the crates that depend on a bumped crate through a normal or build dependency with a version requirement. Crates that share an inherited version are versioned together, and a configuration that would version them apart fails before anything is written. It updates every version requirement on a bumped crate in the repository's Cargo workspaces, in `[workspace.dependencies]` and in crates outside the release too, so that each workspace still resolves, and it brings the `Cargo.lock` of each workspace whose manifests changed up to date without moving any other locked package. It stops where a crate of the release would get a rewritten requirement on a bumped crate without a new version of its own, and where a place that names a bumped crate with a version would stop working with the new version and cannot be rewritten. Every check of `nx release version` runs before it writes its first file, so a run that a check stops changes no file; a failure while the files are written, which no check foresees, can leave some of them changed and unstaged.

`nx release publish` publishes the selected crates with `cargo publish`, each to the registry that Cargo's own settings choose for it. It never uploads a crate while a crate of the repository that it needs as a normal or build dependency lacks its version in the registry that the dependency's entry points to: such a crate, unless the same cargo call publishes the dependency, fails before anything is uploaded and says which dependency to publish first. It leaves out a crate whose version the registry already has, never publishes a crate with `publish = false` or a [[TERM-HACK-CRATE]], and fails before anything is uploaded for a crate that depends, with a version requirement, on a crate of the repository that is not published to the registry that the dependency's entry points to, saying why and how to change that and, for a hack crate, how such a crate can be published. A crate's task that receives Nx's `registry` option fails before anything is uploaded and says how Cargo chooses a registry instead. Publishing changes no tracked file outside Cargo's build directory.

A dry run of `nx release version` writes nothing, and a dry run of `nx release publish` uploads nothing and changes no tracked file outside Cargo's build directory. The dry run of `nx release publish` checks each crate that would be published against the registry and against the new versions of the other crates of its cargo call, and reports each crate that it could not check because another call would publish the new version of one of its dependencies. Publishing napi and wasm packages to npm is not part of it ([[ADR-V1-SCOPE]]).
:::

## Design

:::mara design DES-RELEASE
:mid: 01M78FHG7F65ZV4NB8NPNJGH1T
:title: Release flow
:status: accepted
:satisfies: REQ-RELEASE

Nx release works out the bumps, walks dependents, writes changelogs and makes the commit, tag and push itself. The plugin adds the version actions for `Cargo.toml`, the lockfile step, the target `nx-release-publish` with its executor, and the checks before each publish call ([[EVD-NX-24-RELEASE]], [[EVD-NX-24-VERSION-ACTIONS]]). The maintainer chose the four answers that had real alternatives on 14 November 2026: one `cargo publish` per workspace ([[ADR-BATCHED-PUBLISH]]), one fixed release group for an inherited version, dependents from the manifests with requirements rewritten everywhere ([[ADR-RELEASE-DEPENDENTS]]), and an early failure for the hack crate. The control plane of the work settled the rest the same day from the measured facts ([[EVD-CARGO-PUBLISH]]): how requirements are rewritten, the lockfile step, and that npm publishing of napi and wasm packages stays out ([[ADR-V1-SCOPE]]). After a review of this design, the control plane decided the same day, and the maintainer is told: the check that a dependency's version is in the registry before a crate is uploaded, the dry run's limit across cargo calls, `--locked` on every publish call, what happens to a compound requirement that still matches, and the early failure for every dependency that is not published, which extends the maintainer's answer for the hack crate. The research on Nx's `--registry` (nxr-fwxn1r) brought the maintainer's choice, the same day, that a crate's task fails on Nx's `registry` option with guidance ([[ADR-PUBLISH-REGISTRY-OPTION]]), and three decisions of the control plane, of which the maintainer is told: the checks compare the registry that a dependency's entry points to with the registry the dependency is published to (**Where a dependency points**), the calls are split by registry as well ([[ADR-BATCHED-PUBLISH]]), and the executor learns that registry from cargo and names it to cargo (**Target registry**) ([[EVD-CARGO-PUBLISH-REGISTRIES]]). A review the same day corrected the first and the probe of the second, and after a second review the control plane put every registry question under one principle (**Registries**); the maintainer is told. The maintainer chose the same day that a crate that would publish to crates.io fails where the Cargo configuration replaces crates.io ([[ADR-PUBLISH-REPLACED-CRATES-IO]]).

**Registration.** Each crate's project carries `release.version.versionActions`, which names the plugin's version actions through its package, `@convesoft/nx-rust/src/release/version-actions`, so that Nx resolves them from the repository root and every checkout gives the project the same configuration. `createNodes` sets it as Nx allows for a project's `release.version`, and Nx takes it ([[EVD-NX-24-VERSION-ACTIONS]]), so neither `nx.json` nor `@nx/js` is needed for them. The workspace project of a root manifest without a `[package]` table carries none: it has no version, and the user leaves it out of the release projects. The version actions find a project's crate through its `metadata.cargo`, the package name and manifest ([[DES-PROJECT-GRAPH]]), because the Nx name can differ from the package name. They read the repository's Cargo workspaces, those whose root manifest a project of the graph names, from one `cargo metadata --no-deps` report each, started in the workspace's root folder ([[DES-INVOCATION]]).

**Current version.** The version actions read the current version from the crate's manifest, following `[workspace.package].version` where the crate inherits it, which is what Nx's default `disk` resolver asks for. `git-tag` works as Nx provides it. The `registry` resolver is not supported in v1: a project of the release whose `currentVersionResolver` is `registry` fails versioning with a message that says so and names `disk` and `git-tag`. A crate in the release whose manifest has no `version`, which cargo reports as 0.0.0, or which inherits a version that `[workspace.package]` does not set, fails versioning with a message that names the manifest. Both checks run when Nx loads the version actions, for every project configured for release, because Nx replaces an error from reading a current version with a message of its own, which in both cases would point elsewhere ([[EVD-NX-24-VERSION-ACTIONS]]).

**Inherited versions.** Crates of one Cargo workspace that inherit `version.workspace = true` share one version. They are versioned together or not at all: they must be in one fixed release group, and a release configuration that puts them into different groups, or a run that would version some of them and not others, fails before anything is written, with a message that names the crates and the groups. The version actions check the groups when Nx validates the run, and the run when they write the version, because Nx adds a crate to a run as a dependent of a crate in another group without the rest of its group ([[EVD-NX-24-VERSION-ACTIONS]]). The version is written once, to `[workspace.package].version`; where Nx bumps a crate twice in one run, first as a dependent and then by its group's own bump, as it does for the crates of a fixed group that depend on a crate of an independent group bumped in the same run, the last version stays, as it does for a version of a crate's own ([[EVD-NX-24-VERSION-ACTIONS]]). The maintainer's option, word for word: "Require one fixed release group (Recommended)". Rejected: independent groups that silently move every crate inheriting the version, whose versions would then change without Nx's tags and changelogs; and no support for inherited versions, as in `@monodon/rust` 3.0.0, which blocks a common layout ([[EVD-NX-24-RELEASE]]). The rule binds only crates that share an inherited version: a crate with a version of its own can be in another release group than a crate it depends on.

**Dependents.** The version actions read a crate's dependencies from its workspace's `cargo metadata --no-deps` report ([[DES-METADATA-REPORT]]), not from the project graph, whose `implicit` edges are a superset kept for the cache key ([[ADR-RELEASE-DEPENDENTS]]). Nx release takes dependents only from what the version actions report ([[EVD-NX-24-RELEASE]]). A dependency makes the crate a dependent of the crate it names when it names, by path, a crate with an Nx project, is of kind normal or build, and carries a version requirement, in its own entry or in the `[workspace.dependencies]` entry it inherits. The report gives the requirement `*` both for an entry without a version requirement and for the requirement `*` written out ([[EVD-CARGO-PUBLISH]]), so the version actions read the manifest to tell the two apart. They find the dependency's entries there by its kind, its key, which is the rename where it has one, and the folder that it names, its own path or that of the `[workspace.dependencies]` entry it inherits, not by the platform of its target table, which cargo's report writes normalised, so that `cfg( unix )` in a header is `cfg(unix)` in the report; where entries in several target tables name the crate, a requirement in any of them counts. Where the manifest holds no such entry, versioning fails before anything is written, with a message that names the manifest and the dependency. Optional, renamed and target-specific dependencies count. The path identifies the crate at the real path of its folder, as in [[DES-PROJECT-GRAPH]], and a crate of another workspace is found in that workspace's report. Dev-dependencies make no dependent, by the maintainer's choice: the crates that use a crate never build its dev-dependencies, although cargo keeps a dev-dependency with a version requirement in the published manifest. Dependencies without a version requirement make no dependent either: cargo leaves such a dev-dependency out of the published crate and refuses to publish a crate with such a normal dependency ([[EVD-CARGO-PUBLISH]]). Under Nx's default `updateDependents`, each dependent gets a patch bump.

Nx decides two kinds of bump across release groups without the reported dependencies ([[EVD-NX-24-VERSION-ACTIONS]]), which show only where groups take their bumps from conventional commits or version plans: with a specifier on the command line, every crate of the run gets it. The maintainer answered both on 14 November 2026 (nxr-5a9w1y), with the options chosen, word for word:

- A fixed release group that gets no bump of its own is bumped as a whole through any edge of the project graph to a project of a group that Nx bumped before it, the plugin's `implicit` edges included, so also through a dev-dependency or an edge that the plugin adds for the cache key, and whether it happens depends on the order of the groups in `nx.json`. "Accept it and say so in the output (Recommended)": the run goes on, and for each project of the group that has such an edge, the output names the group, the edge and what it is in Cargo, a normal, build or dev-dependency or no dependency at all, and calls it a known limit of Nx release. The version actions know it from the reason `DEPENDENCY_ACROSS_GROUPS_WAS_BUMPED` with which Nx asks the project's `calculateNewVersion` for its version, right before its `updateProjectVersion`, and they name the project's edges into release groups in which the run has written a version by then. Nx judges a group bumped by the first of its projects in the run, so where several groups are involved, the line can name an edge into a group of which Nx counted another project; where the project has no such edge, the line names the group without an edge. Rejected: stopping such a run.
- A crate in an independent group that depends, through a normal or build dependency with a version requirement, on a crate of a fixed group is not bumped when Nx bumps that group as a whole, unless its own group bumps it, while its requirement is rewritten. "Stop such a run before anything is written (Recommended)": versioning fails, naming each crate whose requirement would change without a bump and its release group, and says to release it in the same run. Rejected: accepting it. The version actions check it once every version of the run is decided and before Nx writes anything: Nx calls `updateProjectDependencies` for each crate whose version the run writes only after its last version decision, and the first of these calls checks every requirement that the run rewrote in a normal or build dependency table, or in a `[workspace.dependencies]` entry for each member that inherits it there, against the crates whose versions the run writes. The check covers every crate configured for release whose requirement the run rewrites without a bump, so it also stops a run in which `updateDependents` is `never`, or `auto` across groups, keeps Nx from bumping such a crate; the maintainer confirmed this on 14 November 2026, word for word: "Yes, stop in every such run (Recommended)". Rejected: following `updateDependents`. A crate outside the release and a dev-dependency stay as **Requirements** says: their requirements are rewritten without a bump.

**Requirements.** When a crate's version changes, every version requirement on it, matched by path, is updated in every manifest of the repository's Cargo workspaces that the plugin reads, at the moment the version actions write the crate's new version, because Nx asks for the dependency updates of crates in the release only: in each member's dependency tables of every kind and their `[target.*]` forms, whether the member is released or not and whether it has an Nx project or not, in each root manifest's `[workspace.dependencies]` and `[patch.<source>]` tables, and in the `[patch.<source>]` tables of the Cargo configuration files that cargo reads for each workspace ([[DES-METADATA-REPORT]]). A dependency that inherits its entry with `workspace = true` is updated where the requirement is written, in `[workspace.dependencies]`. A `[patch]` entry that names a bumped crate by path and carries a version requirement is a requirement on that crate: cargo fails once the crate's new version leaves it ([[EVD-CARGO-PATCH-AFTER-BUMP]]), so it is rewritten, kept or fails versioning by the same rules as any other, and it never makes a dependent or bumps a crate; the control plane decided this on 14 November 2026, within the maintainer's "rewrite everywhere". Cargo ignores `[patch]` in a member's manifest, and so do the version actions. No file outside the repository is written: a requirement there that has to change, as in the Cargo home's configuration, fails versioning with a message that names the file. Three more places can name a bumped crate with a version, and each fails versioning before anything is written, with a message that names the file and says what to do, where the new version would leave it ([[EVD-CARGO-PATCH-AFTER-BUMP]]): a `[replace]` entry whose path names the crate, because cargo takes a replacement only with the version it replaces and fails after the bump, while a key rewritten to the new version leaves the replacement unused; a registry or git requirement that a `[patch]` entry naming the crate by path redirects to it, which the old version satisfied and the new one does not, because cargo would take the package from the registry instead without an error; and a profile's package table whose specification names the crate with a version, as `base@0.1.0`, `base:0.1.0`, `base@0.1` and the forms `path+file://` and `file://` of the crate's folder with `#base@0.1.0` or `#0.1.0`, because the profile's settings would stop applying to it with a warning only. The version actions take a `[patch.<source>]` table to apply to a registry or git dependency where the key is `crates-io` and the dependency comes from crates.io; where the key is a URL that names the dependency's git repository or registry index as cargo compares them, with `sparse+` kept for a sparse index; or where the key is a registry's name that `CARGO_REGISTRIES_<NAME>_INDEX` or the `[registries]` table of the workspace's Cargo configuration maps to the dependency's index, or that the dependency's entry names. A name that none of these maps or names is not matched. So after a run that succeeds, every place in the repository's manifests and in the Cargo configuration that names a bumped crate with a version accepts its new version, and cargo resolves every Cargo workspace of the repository as before, as far as the bumped crates go. For the redirected registry requirement, the maintainer chose on 14 November 2026 (nxr-6kmd0d), word for word: "Keep stopping the run (Recommended)". Rejected: rewriting it like any other requirement, although cargo then takes the member again ([[EVD-CARGO-PATCH-AFTER-BUMP]]). A requirement that the new version satisfies is kept while Nx's `preserveMatchingDependencyRanges` is on, its default; the setting that counts is that of the crate whose manifest holds the requirement, where that crate is configured for release, and otherwise, as in `[workspace.dependencies]`, that of the crate whose version changes. With it off, a bare, `^`, `~` or `=` requirement is rewritten to the new version. Any requirement that the new version leaves is rewritten to the new version with its operator kept, where it has one of these forms. A requirement of another form, such as a comparison or a wildcard, is kept unchanged as long as the new version satisfies it, also with `preserveMatchingDependencyRanges` off, and the output says so, naming the manifest and the requirement: the plugin rewrites only the forms that it can rewrite without inventing bounds, and a requirement that still matches needs no change to stay correct. Such a requirement that the new version leaves fails versioning before Nx writes any file, with a message that names the manifest, the dependency and the requirement. The control plane decided the case of a matching compound requirement on 14 November 2026 after the review. Nx's `versionPrefix` has no effect, because a rewritten requirement keeps its operator, and neither has `manifestRootsToUpdate`: the version actions write the crates' own manifests. Only version strings change in a manifest. The version actions replace the characters of each version string in the manifest's text, between the string's own quotes, at the place that a scanner of their own finds for its key, and refuse the edit, before Nx writes anything, unless the edited text, parsed by smol-toml, differs from the old one in exactly those values. So comments, layout, the order of keys, quoting, line endings and a missing final newline stay byte for byte. A TOML package that writes the document anew was not taken: smol-toml keeps no layout, `@ltd/j-toml`, which `@monodon/rust` uses, reformats the file ([[EVD-NX-24-RELEASE]]), and a package that reports places would be a new dependency for finding a few strings. The version actions list every manifest and configuration file that they change in their `manifestsToUpdate`, which is how Nx excludes a file from its formatting pass, so that a formatter that formats TOML, such as oxfmt, leaves them alone ([[EVD-NX-24-VERSION-ACTIONS]]). Failing on every requirement that the new version leaves, as `@nx/js` does for npm ranges, was not taken: every Cargo requirement is a range, so it would block every breaking release ([[EVD-NX-24-RELEASE]]).

**Writes.** Nx keeps the changes of a run in its tree and writes them once every release group is processed, without a way back ([[EVD-NX-24-VERSION-ACTIONS]]). Every check of the version actions runs before that, so a failure of a check leaves every file as it was. Among the checks is one that every file that the run changes lies inside the repository and can be written. A file is inside the repository when its real path, with the symbolic links of the file and of every folder on its way followed, lies within the real path of the repository root; a file whose path lies inside but which a link leads outside, such as a `.cargo/config.toml` that links elsewhere or the manifest of a member whose folder is a link, fails the run before any write, with a message that names the file and where it leads. A file whose path lies outside the repository is never written (**Requirements**). A failure while Nx writes, such as a disk that is full or a file that becomes read-only meanwhile, can still leave some files changed and unstaged, without a commit or tag; `git checkout` undoes them ([[RISK-NX-RELEASE]]).

**Lockfile.** The version actions module exports `afterAllProjectsVersioned`, which Nx calls once after it has written the manifests and before it commits. It runs `cargo update --workspace` in the root folder of each Cargo workspace whose manifests the run changed ([[DES-INVOCATION]]). It runs online, because `--offline` fails with an empty Cargo home as on CI, and never with `--locked`, also in locked mode, because the lockfile has to change, as for the `update` target ([[DES-WORKSPACE-TARGETS]]). Cargo then changes the bumped members' entries and the references in other entries' dependency lists that spell out a version or a source, and moves no other locked package ([[EVD-CARGO-PUBLISH]]). The function returns the lockfiles that cargo changed and that git does not ignore, which Nx stages, and commits with the manifests where the git settings of `nx release version` ask for a commit or the command is `nx release` ([[EVD-NX-24-RELEASE]]). When cargo fails, the release fails with a message that names the workspace and carries cargo's message, and Nx makes no commit. In a dry run it runs nothing, because Nx has written no manifest. Release may write the lockfile ([[REQ-NO-MANIFEST-WRITES]], [[ADR-V1-SCOPE]]). `@monodon/rust` 3.0.0 runs the update in the Nx root only and swallows its failures ([[EVD-NX-24-RELEASE]]); a workspace elsewhere would keep a stale lockfile.

**Publish target.** Every crate without `publish = false`, other than the hack crate, has the target `nx-release-publish`. Nx release runs that name only ([[EVD-NX-24-RELEASE]]), so `targetNames` does not apply to it ([[DES-TARGETS]], [[DES-PLUGIN-OPTIONS]]). The target is not cached ([[DES-OUTPUTS]]) and has no `dependsOn` ([[REQ-NO-RUST-TASK-DEPS]]). It runs the executor `@convesoft/nx-rust:release-publish`, which declares a batch implementation and `preferBatch: true` ([[ADR-BATCH-EXECUTOR]], [[ADR-BATCHED-PUBLISH]]).

**Batch.** `nx release publish` runs one release group after another, in the order of the dependencies that the version actions report, so a batch holds the runnable `nx-release-publish` tasks of one group ([[EVD-NX-24-RELEASE]]). The batch implementation runs one `cargo publish --locked` per Cargo workspace and target registry (**Target registry**), started in the workspace root, with the registry as **Target registry** names it and a `-p` and the real package name for each crate of its tasks that the checks below leave in ([[DES-INVOCATION]]). Crates of one workspace that cargo publishes to different registries go into separate calls, because one call for crates whose `publish` settings differ fails as a whole, while plain cargo publishes each of them alone ([[ADR-BATCHED-PUBLISH]], [[EVD-CARGO-PUBLISH-REGISTRIES]]). Cargo orders those crates, packages and verifies each against the others before it uploads any, waits after each upload until the registry's index lists it, and stops rather than publish a crate after the wait for one it depends on has timed out ([[EVD-CARGO-PUBLISH]]). The calls run one after another, a call after those whose crates its crates depend on with a version requirement, in another workspace or for another registry of the same one, so that a dependency is in the registry when the call of its dependents is checked. Where such dependencies form a cycle between calls, no order satisfies cargo, and the checks or cargo fail the call that cannot resolve. Cargo's output is mapped to one result per task: a task succeeds when cargo uploaded its crate, or in a dry run verified it, and fails otherwise. The batch reports a result for every task it receives, also for one that it does not hand to cargo, because Nx starts a new batch without end for a task left out, and it does not throw, because a throw fails every task of the batch ([[EVD-NX-24-BATCHES]]). Known limit: Nx orders release groups by the reported dependencies, which leave out dev-dependencies, so a crate whose dev-dependency with a version requirement is published in a later group fails verification with cargo's message, and a second run publishes it.

**Registries.** The plugin uploads a crate only where it can establish, from what cargo itself reports, which registry each lookup before the upload asked and which registry the upload goes to, and that they are the same. Where it cannot establish that, the crate fails before any upload, and so does each crate that depends on it with a version requirement, with a message that says what could not be established and how to configure Cargo plainly. A wrong failure in an unusual configuration is accepted; an upload against the wrong registry is not. A registry's name does not establish it: lookups follow a replacement of a named registry while `cargo publish` uploads to the registry by its name, two names can configure one index, of which cargo then shows one for both, and one name can configure different indexes in the configuration files of two Cargo workspaces ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The paragraphs **Target registry**, **Lookups**, **Where a dependency points**, the checks before each call and **Existing versions** apply this. The control plane decided it on 14 November 2026, after two reviews of this design, and the maintainer is told.

**Target registry.** The executor names to cargo the registry that cargo would publish a crate to. Cargo takes `--registry`; else `registry.default`, from `CARGO_REGISTRY_DEFAULT` or from its configuration files, which wins over a crate's `publish` list, so that cargo refuses a crate whose list leaves it out; else the one entry that the `publish` lists of all crates of the call share; else crates.io, which it refuses while its configuration replaces crates.io ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The executor reads each crate's `publish` from the report and `CARGO_REGISTRY_DEFAULT` from the task's environment. It does not read `registry.default` from configuration files: cargo has no stable command that prints it, and Cargo 1.91 ignores a value set through `include` that later versions apply. So, for the crates that it is about to publish and the crates of the repository that they depend on, other than those with `publish = false`, which go nowhere:

- Where `CARGO_REGISTRY_DEFAULT` holds a name, that name is every crate's target registry, and no probe runs. A crate whose `publish` list leaves it out fails before cargo runs, with a message that names the list and the registry, because cargo would refuse it, and in a call with other crates the whole call.
- Otherwise the executor asks cargo, once per workspace and distinct `publish` value, with `cargo publish --dry-run --no-verify --locked -p <crate>` for one crate of that value, started in the workspace root with `CARGO_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR` naming a new folder of the plugin's own outside the repository, which it removes afterwards. Cargo writes the packaged crate into the `package` folder of its build directory, which is the target directory unless the configuration sets `build.build-dir`, and overwrites what lies there, also files that the repository tracks; with both variables set, nothing of the probe lands in the repository on either version, and the probe's output is the same ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The first line of cargo's output that starts with `Updating` shows the registry that cargo chose, ``Updating `<name>` index`` or `Updating crates.io index`, also where cargo goes on to fail, such as on a dependency that is not in the registry yet or on a stale lockfile. Where two names configure one index, cargo shows one of them for both: with `alias` and `alpha` on one index, the probe of a crate with `publish = ["alpha"]` said "found `alpha` as only allowed registry" and then ``Updating `alias` index`` ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The name that the executor passes is therefore, for a one-entry `publish` list, its entry, which cargo has accepted once the line appears; for a list of several entries, the entry that the line names literally, and where it names none, the crates fail; and without a list, the name that the line shows. The executor asks about a crate with a one-entry `publish` list too: a `registry.default` in a configuration file wins over the list and cargo refuses the crate, while passing the list's entry would publish it. Where cargo fails before such a line because it cannot choose, as for a list without the default, a list of two entries and no default, or crates.io replaced and no default, each task of those crates fails with cargo's message, which plain `cargo publish` gives for them as well. The probe uploads nothing.
- The executor then passes `--registry <name>` to the `cargo publish` of those crates, which uploads to the index that the configuration gives that name, also where the configuration replaces that registry, and which refuses a name that a crate's `publish` list leaves out before it uploads anything ([[EVD-CARGO-PUBLISH-REGISTRIES]]). It never passes `--registry crates-io`: under a replacement of crates.io, `cargo publish --registry crates-io` goes to crates.io itself. For crates.io it passes no `--registry` to `cargo publish`, which then publishes to crates.io as the probe or the environment said.

The executor never guesses a target registry: a crate whose registry it cannot tell is not published, and its task fails, and so does the task of each crate that depends on it with a version requirement, with a message that names it. The control plane decided this on 14 November 2026, and the maintainer is told.

**Lookups.** The executor looks a version up with `cargo info <crate>@<version> --registry <name> --locked`, and on crates.io with `--index sparse+https://index.crates.io/` in place of `--registry`, with the name that **Target registry** gives, started in the root of the Cargo workspace of the crate looked up. Without `--registry` or `--index`, `cargo info` describes the workspace's own crate of that name on Cargo 1.100 and asks the default registry on 1.91, and without `--locked` it rewrites a stale `Cargo.lock` ([[EVD-CARGO-PUBLISH-REGISTRIES]], [[EVD-CARGO-PUBLISH]]). A lookup establishes which registry it asked only where the first line of its output that starts with `Updating` names that registry as the executor passed it, ``Updating `<name>` index``, or says `Updating crates.io index` for crates.io, and where, for a version found in a named registry, its `version:` line says ``from registry `<name>` `` with the same name. Cargo shows everything else there ([[EVD-CARGO-PUBLISH-REGISTRIES]]): with `alpha` replaced by `beta`, a lookup with `--registry alpha` printed ``Updating `beta` index`` and ``from registry `alpha-src` ``, the name of the table that replaced it, and where the replacement was a table named `alpha` holding `beta`'s index, ``Updating `alpha` index`` but still ``from registry `alpha-src` ``; where two names configure one index, it printed one of them for both; and offline, by `CARGO_NET_OFFLINE` or `net.offline`, it printed no `Updating` line and answered from its cache. Where the source is established, exit code 0 means that the registry has the version and 101 with "could not find `<crate>@<version>`" that it does not, a full version being matched exactly; any other failure, such as an unreachable registry, fails the task with cargo's message. A lookup that does not establish its source fails, whatever it answered, the task of the crate that it concerns and of each crate that depends on that crate, with a message that names the lookup and what cargo printed in place of the registry, and says to configure the registry under one name, without a replacement, and to publish online. The plugin does not change offline mode: offline, `cargo publish` refuses too, with "attempting to make an HTTP request, but --offline was specified", and the executor never passes `--offline`.

**crates.io replaced.** On a machine whose Cargo configuration replaces crates.io, a crate that would publish to crates.io fails before `cargo publish` runs, with each crate that depends on it, and its message says to publish it from a job whose Cargo configuration does not replace crates.io. The executor sees the replacement in the lookup on crates.io, whose `Updating` line then names the replacement, and in the probe of a crate without a `publish` list, which cargo refuses with "crates-io is replaced with …", to which the executor adds this guidance. A `publish = ["crates-io"]` list or `CARGO_REGISTRY_DEFAULT=crates-io` would make `cargo publish` go to crates.io itself past the replacement, while the lookup asks the replacement ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The maintainer's option, word for word: "Keep failing, with guidance (Recommended)" ([[ADR-PUBLISH-REPLACED-CRATES-IO]]). Rejected: passing `--registry crates-io`.

**Where a dependency points.** For each dependency, cargo writes into the published crate the registry that the dependency's entry names with `registry`, and crates.io where it names none, and the crates that use the published crate resolve the dependency there. Cargo's configuration never changes it, a replacement of crates.io included: with crates.io replaced by the registry that a call published to, cargo resolved an entry without the key in that registry while it packaged the crate, and still recorded crates.io for it, so that the crate in that registry depends on crates.io's crate of that name ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The executor reads it from the report of the dependent's workspace ([[DES-METADATA-REPORT]]): a dependency's `registry` is `null` for an entry without the key, crates.io's index URL for `registry = "crates-io"`, and otherwise the index URL of the registry that the entry names, also for an entry inherited from `[workspace.dependencies]`. Both `null` and crates.io's URL mean crates.io; any other registry's name is the entry's `registry` value in the manifest, for an inherited entry in the `[workspace.dependencies]` entry that it inherits. A `registry` key that no configuration names makes `cargo metadata` fail, and with it graph creation, so the registry has to be configured wherever cargo reads the manifest ([[EVD-CARGO-PUBLISH-REGISTRIES]]). The executor asks for the report when the task starts, in the task's environment. The registry that an entry points to is established as the dependency's own target registry (**Target registry**) only where both are crates.io; or where the dependency and the crate that needs it are in one Cargo workspace, whose configuration files and environment are then the same for both, and the entry names the very name that the executor passes for the dependency; or where `CARGO_REGISTRIES_<NAME>_INDEX` in the task's environment gives the target registry's index, which then holds in every workspace because the environment wins over configuration files, and the report gives the entry that index ([[EVD-CARGO-PUBLISH-REGISTRIES]]). Nothing else establishes it: not two names for one index, the entry naming one and the dependency published under the other; not one name that the configuration files of two workspaces give different indexes, where a dependent in the second workspace was uploaded against a copy of the dependency in its index while the dependency went to the first; and not any other dependency between two Cargo workspaces on a registry other than crates.io whose index only configuration files give. The control plane decided on 14 November 2026, after a review, that the checks compare this registry, and not the one where cargo resolves the dependency on the publishing machine, and after a second review that two registries count as one only as established here; the maintainer is told.

**Checks before each call.** Before each `cargo publish`, with or without a batch, the executor checks each crate that the call would publish, in this order:

- _Unpublished dependencies._ A normal or build dependency with a version requirement on a crate of the repository that is not published to the registry that its entry points to (**Where a dependency points**), through `publish = false` or a `publish` list that does not hold that registry by the entry's own name, `crates-io` for crates.io, fails the crate's task. Cargo packages such a dependency for that registry whatever the dependency's `publish` says: it fails to resolve where the registry has no crate of that name, and it resolves to an unrelated crate where the registry has one, which cargo then publishes as the dependency ([[EVD-CARGO-PUBLISH]]). The message names the crate and the dependency and says that the dependency has to be published to that registry, or the entry's `registry` key has to name a registry that the dependency's `publish` list allows, or the dependency has to stop being a normal or build dependency; for a hack crate it adds cargo-hakari's ways (**Hack crate**). The control plane extended the maintainer's answer for the hack crate to every such dependency on 14 November 2026, as its consequence. A dependency without a version requirement is left to cargo, which refused a crate with such a normal dependency before it uploaded anything of its call ([[EVD-CARGO-PUBLISH]]).
- _Dependencies published elsewhere._ For every other normal or build dependency with a version requirement on a crate of the repository, also one that the same call publishes, the registry that its entry points to has to be established as the dependency's own target registry (**Where a dependency points**). Otherwise the crate's task fails before any upload, with a message that names the dependency, the manifest that holds its entry, which is the root manifest for an entry inherited from `[workspace.dependencies]`, the crate that needs it, the registry that the entry points to and the registry that the dependency is published to, says what could not be established, and says what to do: add the `registry` key with the dependency's registry to that entry, or correct it; use one name for one index; and for a dependency in another Cargo workspace, give the registry's index in the environment as `CARGO_REGISTRIES_<NAME>_INDEX` or keep both crates in one workspace. This happens to every dependency without a `registry` key on a crate that is published elsewhere than crates.io, to a registry that replaces crates.io as well. Cargo would otherwise publish the crate pointing at another registry's crate of that name: where it resolves the entry in a registry that lacks the version, packaging fails, and where it finds the version, through a replacement of crates.io or in an unrelated crate, it uploads the crate depending on the crate of that name in the registry that the entry points to, crates.io for an entry without the key, also in one call with the dependency, and although `cargo info` had found the version in the dependency's own registry ([[EVD-CARGO-PUBLISH-REGISTRIES]]). For a crate published to crates.io, a dependency whose entry names another registry passes the check where the dependency is published to that registry; what cargo and crates.io then do with the crate is not established ([[RISK-REGISTRY-BEHAVIOUR]]). The control plane decided this check, without an exception for a dependency of the same call, on 14 November 2026, and the maintainer is told.
- _Dependencies published first._ For each such dependency that passes both checks above, other than one that the same call publishes, the dependency's version in its manifest must already be in the dependency's target registry, by a lookup that establishes its source (**Lookups**). Otherwise the crate's task fails before any upload, with a message that names the dependency, its version and the crate that needs it, and says to publish the dependency first: in the same `nx release publish`, which publishes a dependency's workspace and release group first, or by running the dependency's task before this one. This holds across workspaces and release groups. Cargo would otherwise upload the crate against any registry version that its requirement accepts: with `a` 0.1.0 in the registry and `a` bumped to 0.1.1 beside `b`, whose requirement `0.1.0` still matched, `cargo publish -p b` uploaded `b` built against `a` 0.1.0, and `a` 0.1.1 was never uploaded ([[EVD-CARGO-PUBLISH]]). The control plane chose a check over a narrower promise because an upload cannot be undone. In the normal flow the check passes: cargo waits after each upload until the index lists it, for up to 60 seconds, and right after a call had published a crate, the lookup of **Lookups** found its version ([[EVD-CARGO-PUBLISH]]). Where the index is slower than that, the check fails the dependent before any upload, and a second run publishes it.

A crate whose task fails a check is left out of the call, and so is each crate of the call that depends on a crate left out, whose task fails with a message that names that crate; the rest of the call runs.

**Dry run.** With `--dry-run`, the executor passes `--dry-run`, and cargo verifies the crates of a call without uploading, each against the registry and against the new versions of the other crates of the same call. That overlay does not carry from one call to the next: after the dry run of a crate's call, the dry run of a dependent's call in another workspace failed with "no matching package named" ([[EVD-CARGO-PUBLISH]]). In a dry run, a crate whose dependency fails only the check _Dependencies published first_, because another call would publish it, is therefore not handed to cargo, and neither is a crate of its call that depends on it. Its task succeeds and says that the crate was not verified, naming the dependency, its version and the task that would publish it, `<project>:nx-release-publish`. The other crates of the call are verified. This happens across Cargo workspaces, across the registries of one workspace and across release groups, which the rule for inherited versions does not prevent. A dependency that no task would publish, or that is not published to the registry that its entry points to, fails as in a real run. The control plane decided this limit on 14 November 2026 after the review; a real run is covered by the checks.

**Existing versions.** Nx runs the target on every crate of a group, bumped or not, and cargo fails a whole multi-crate call before uploading anything when one selected version already exists ([[EVD-CARGO-PUBLISH]]). The executor therefore looks each crate of the call up in the call's target registry (**Lookups**), leaves out each crate whose version that registry already has, and its task succeeds with a message that names the crate and the version, so a second run after a partial publish publishes the rest. A crate whose lookup does not establish its source fails before any upload, because a version found elsewhere would leave the crate unpublished while its task reported success.

**Tracked files.** Every `cargo publish` and `cargo info` that the executor runs passes `--locked`, whatever the plugin's `locked` option says ([[DES-INVOCATION]]), so publishing changes no tracked file outside Cargo's build directory, in a dry run or a real one. Into its build directory, which is the target directory unless the configuration sets `build.build-dir`, cargo writes the packaged crates and, where it verifies them, their sources and build, and overwrites what lies there, also files that the repository tracks, as plain `cargo publish` does; the probe of **Target registry** writes into a folder of the plugin's own instead ([[EVD-CARGO-PUBLISH-REGISTRIES]]). Without `--locked`, a dry run with a committed bump beside a stale `Cargo.lock` rewrote the lockfile ([[EVD-CARGO-PUBLISH]]). With it, a stale lockfile fails the call before any upload, with cargo's message, which differs between Cargo versions, and the executor adds that `nx release version` brings the lockfile up to date (**Lockfile**). After that step the multi-crate call with `--locked` succeeds, as a dry run and as a real one ([[EVD-CARGO-PUBLISH]]). The control plane decided this on 14 November 2026 after the review.

**Credentials and tree.** The executor passes no token: cargo takes the token of the registry that it publishes to from its own credentials, as plain `cargo publish` does. For a registry other than crates.io these are `cargo login --registry <name>`, `CARGO_REGISTRIES_<NAME>_TOKEN` and a credential provider configured for it; `CARGO_REGISTRY_TOKEN` holds crates.io's token only and does not apply where `--registry`, `registry.default` or a `publish` list names another registry. `cargo login` without `--registry` saves the token for the registry that `registry.default` names, and for crates.io only where none is named ([[EVD-CARGO-PUBLISH-REGISTRIES]]). It never passes `--allow-dirty`, so cargo refuses to publish uncommitted changes, staged ones too ([[EVD-CARGO-PUBLISH]]); the task then fails with cargo's message and a line that says to commit the new versions first. `nx release` commits and tags by default, while `nx release version` on its own only stages its changes unless `release.version.git` or `--git-commit` asks for a commit; it refuses a root `release.git` unless it is given `--git-commit`, `--git-tag` and `--stage-changes` ([[EVD-NX-24-RELEASE]], [[EVD-NX-24-VERSION-ACTIONS]]). Cargo's `registry.default` and a crate's `publish` list choose the registry as with plain cargo (**Target registry**).

**Options.** The executor's schema declares the options that `nx release publish` passes and that it uses or accepts ([[EVD-NX-24-RELEASE]], [[EVD-NX-24-PUBLISH-OPTIONS]]): `dryRun`, which passes `--dry-run` and which Nx also signals with `NX_DRY_RUN=true`; `registry`, which fails the task (below); and `firstRelease` and `nxReleaseVersionData`, which change nothing. `firstRelease` makes `@nx/js` skip its lookup of the version in the registry; the executor keeps its own (**Existing versions**), because cargo fails a whole call on a version that exists. `tag`, `access` and `otp` are npm's and mean nothing to cargo, which has no distribution tags, access levels or one-time passwords on `cargo publish`: the schema does not declare them, and a task ignores each with a line ([[DES-UNKNOWN-OPTIONS]]). Nx passes `otp` as a number, which a schema that declared it as a string would refuse for every task of the batch.

A task whose options hold `registry` fails before cargo runs, whatever the value and in a dry run too, by the maintainer's decision ([[ADR-PUBLISH-REGISTRY-OPTION]]): ignored, it would publish to another registry than the one asked for, and Nx hands every publish task of the run the same value, an npm URL where npm packages take part. The message names the task, the option, its value and where the value came from. Nx puts `registry` among the overrides of every task of the run only when `nx release publish` receives it, and a target's option or a `targetDefaults` entry only into the task's options ([[EVD-NX-24-PUBLISH-OPTIONS]]). So where the overrides that the task graph holds for the task carry the value that the task received, the message says that the value was passed to `nx release publish`. Otherwise it says that the value comes from the workspace's configuration, names `nx show target <project>:nx-release-publish --json` and its `sourceMap` as in [[DES-UNKNOWN-OPTIONS]], and says that an entry of `targetDefaults` keyed by `nx-release-publish` and written for npm reaches crates unless it has a `filter` or the empty entry keyed by `@convesoft/nx-rust:release-publish` that `init` adds is in `nx.json`, and that an entry keyed by `@nx/js:release-publish` reaches npm packages only ([[EVD-NX-TARGET-DEFAULTS]], [[EVD-NX-24-PUBLISH-OPTIONS]]). The message then gives Cargo's own ways: `publish = ["<name>"]` in the crate's `Cargo.toml`, `registry.default` in `.cargo/config.toml`, or `CARGO_REGISTRY_DEFAULT=<name>` in the environment of one run, which Nx passes on to each task's cargo; with the note that the crate's dependencies on crates of the repository then need `registry = "<name>"` in their entries (**Where a dependency points**). Last, for a repository that also publishes npm packages, it says how to give those alone a registry: publish them in a run of their own, with `--groups` or `--projects` and `--registry`, or set the registry in npm's configuration, such as `.npmrc`. For example:

```text
api:nx-release-publish: the option `registry` (https://npm.example.com/) was passed to `nx release publish`, and nx-rust does not map it to a Cargo registry.
  Cargo chooses the registry itself: set `publish = ["<name>"]` in the crate's Cargo.toml or `registry.default` in .cargo/config.toml, or run `CARGO_REGISTRY_DEFAULT=<name> nx release publish` for one run. Dependencies on crates of this repository then need `registry = "<name>"` in their entries.
  To give npm packages alone a registry, publish them in a run of their own (`nx release publish --groups <group> --registry <url>`) or set it in .npmrc.
```

**Without a batch.** `nx run <project>:nx-release-publish` gives a batch of that one task ([[EVD-NX-24-BATCHES]]). When Nx runs a publish task outside a batch, as with `--batch=false` or `NX_BATCH_MODE=false`, the task runs the same checks and `cargo publish --locked -p <crate>` for its own crate, with its target registry. A crate that needs another crate of the repository then passes the check _Dependencies published first_ only once that crate's new version is in the registry; the tasks run in no set order, because the target has no `dependsOn`, so such a task can fail before any upload, and a second run publishes it.

**Hack crate.** In a workspace with a cargo-hakari configuration, the hack crate is the package that its `hakari-package` names, in `.config/hakari.toml` as `cargo hakari init` writes it, or in `.guppy/hakari.toml` where cargo-hakari reads that file instead ([[EVD-HAKARI-UNIFICATION]], [[DES-UNIFICATION]]). The plugin never publishes it: it has no `nx-release-publish`. When the hack crate has `publish = false`, the check _Unpublished dependencies_ fails each crate that depends on it, and the message points to cargo-hakari's two ways: a stub of the hack crate published once under a unique name, after which plain `cargo publish` works, and `cargo hakari publish` for one crate at a time, outside Nx. On crates.io, a requirement on the common name `workspace-hack` resolves to an unrelated crate ([[EVD-CARGO-PUBLISH]]). Where the hack crate does not set `publish = false`, as such a published stub does, its dependents publish normally once the stub's version is in the registry. The maintainer's option, word for word: "Fail early with guidance (Recommended)". Rejected: running `cargo hakari publish` for each crate, which needs cargo-hakari installed ([[ADR-V1-SCOPE]]) and loses the multi-crate dry run and cargo's stop after a timeout; and taking the dependency out of the manifest around the cargo call, which writes manifests for a moment, needs `--allow-dirty` and leaves them changed when interrupted.

**Other milestones.** Publishing rests on the batch executor of milestone 0.2 ([[ADR-BATCH-EXECUTOR]], [[DES-BATCH]]) and on what Nx does with a batch: on Nx 24.0.6 each task of a batch keeps its own result and terminal output ([[EVD-NX-24-BATCHES]], [[RISK-BATCH-BEHAVIOUR]]). Per-task results from a batch matter here; per-task caching does not, because the target is not cached. The hack crate is recognised through the cargo-hakari configuration that the `hakari` strategy of milestone 0.2 detects ([[DES-UNIFICATION]]).

**Settled during implementation.** These points do not change what the paragraphs above promise. The implementation work settles each with evidence and records it here:

- What cargo-hakari writes beyond the configuration file that names the hack crate ([[EVD-HAKARI-UNIFICATION]]): the forms of the members' dependency on the hack crate in each dep-format version, and whether the crate it generates sets `publish = false`.
- Whether Nx 24 hands the `nx-release-publish` tasks of one release group to one batch under `nx release publish`, as [[EVD-NX-24-RELEASE]] reads it ([[RISK-NX-RELEASE]]). How it drives the version actions was run ([[EVD-NX-24-VERSION-ACTIONS]]).
:::
