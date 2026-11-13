# Workspaces and projects

> **Status:** the plugin finds the Cargo workspaces and creates a project for
> each crate and each workspace, named as this page describes, with an edge
> for each path dependency. The projects have the targets that the status note of
> [Targets](targets.mara.md) names. A crate gets edges to the crates that `[patch]`,
> `[replace]` and `paths` redirect its workspace's dependencies to, so
> `nx affected` follows them. Where such an edge is left out to avoid a cycle,
> and for a redirected crate without a project, the crate's files are inputs
> of the crate's targets ([Caching](caching.mara.md)).

nx-rust finds every Cargo workspace in the repository and turns each member
crate into an Nx project. You do not list crates anywhere: the plugin asks
Cargo.

```text
.
├── nx.json
├── apps/web/                  JS app                -> project "web"
├── rust/                      a Cargo workspace     -> workspace project "rust"
│   ├── Cargo.toml             [workspace] members = ["crates/*"]
│   ├── Cargo.lock
│   └── crates/
│       ├── api/                                     -> project "api"
│       └── core/                                    -> project "core"
└── tools/xtask/               a standalone crate    -> project "xtask"
    ├── Cargo.toml
    └── Cargo.lock
```

## How workspaces are found

The plugin looks at every `Cargo.toml` in the repository and runs
`cargo metadata` once per Cargo workspace. Workspaces can sit anywhere,
including the repository root, and there can be any number of them. It asks
again each time Nx creates the graph and keeps no answer in between; for a
workspace of 600 crates that takes about 0.2 seconds on a fast machine.

- A crate outside every workspace is a **standalone crate**: a workspace of
  one, with its own `Cargo.lock` and its own build directory. The plugin does
  not hide that, so two standalone crates share no compiled dependencies.
- A crate that its workspace lists under `exclude` is also a standalone crate.
- The crates that `cargo vendor` writes are skipped by themselves. A crate
  whose folder holds `.cargo-checksum.json`, which `cargo vendor` writes beside
  each vendored `Cargo.toml`, gets no project and no edge, and the plugin runs
  no Cargo for it, wherever the folder lies and whatever your Cargo
  configuration says. Cargo itself builds from the vendored sources only with
  the `[source]` tables that `cargo vendor` prints, in a `.cargo/config.toml`.
  A vendored crate that one of your crates depends on by path is a member of
  your workspace for Cargo, so it gets a project like any member. To keep Nx
  from reading the folder at all, list it under `exclude` on the plugin's entry
  or in `.nxignore`.
- Crates under paths ignored by `.gitignore` or `.nxignore` are skipped. Use
  `exclude` on the plugin's entry in `nx.json` for generated crates or other
  crates that are checked in ([Configuration](configuration.mara.md)). A crate that depends by
  path on a skipped crate still gets that crate's files into its cache key
  ([Caching](caching.mara.md)). To find them, the plugin still asks Cargo about
  the skipped crate, so a broken manifest there fails the graph even when it
  is excluded, just as plain cargo fails for the crate that depends on it.
- If cargo is not installed, or `cargo metadata` fails for a manifest, the
  graph fails with cargo's message. Nothing is left out silently, so every
  machine that runs `nx` in the repository needs cargo
  ([Setup](setup.mara.md)).
- Building the graph needs no network and downloads no crates. The plugin asks
  Cargo only about the workspace itself (`cargo metadata --no-deps`), which
  also never touches `Cargo.lock`.
- Building the graph installs no toolchain either. The plugin runs Cargo in
  each workspace's root folder, so the `rust-toolchain.toml` that applies there
  counts. If it names a toolchain that is not installed, the graph fails with
  rustup's message, which names the toolchain. Run `rustup toolchain install`
  in that folder to install it. Plain `cargo` still installs it as before.

Everything Cargo scopes to a workspace stays per workspace: the lockfile, the
build directory, the toolchain file, the batches and the coverage baseline. That is
why a cache input is a real path such as `rust/Cargo.lock`, never one
repository-wide name for "the lockfile".

## Project names

A project is named after its crate. If two crates in the repository have the
same name, the graph fails: Nx's error names both folders, and nx-rust's error
after it names both manifests and how to rename one of them:

```toml
# tools/api/Cargo.toml - a second crate called "api"
[package.metadata.nx]
name = "tools-api"
```

A per-workspace prefix does the same for all members of a workspace:

```toml
# tools/Cargo.toml
[workspace.metadata.nx]
namePrefix = "tools-" # "api" becomes "tools-api"
```

The prefix is used as it is, with no separator added. A crate that sets its own
`name` gets exactly that name, without the prefix. Renaming the project changes
nothing for Cargo: every command still uses the real package name and manifest
path.

A crate whose folder is also a JS project takes that project's name, from its
`package.json` or its `project.json`, because Nx applies those files after
every plugin. Where Nx takes the name from one of those files, the crate's
`name` override has no effect; a `project.json` without a name and without a
`package.json` beside it keeps the name the plugin gives the crate. To choose
another name, set `name` in the folder's `project.json` if it has one, and
otherwise `nx.name` in its `package.json`. Such a name also settles a
collision between two crates. A crate and a JS project with the same name make
Nx fail with its own error, which names both folders. In such mixed cases, and
when three or more projects share a name, nx-rust's error may be missing or
incomplete; Nx's error always names every folder.

## Workspace-level tasks

Some tasks belong to a workspace, not to one crate: documentation, `cargo audit`,
`cargo deny`, lockfile updates and coverage collection. Each workspace has one
project for them, rooted at the workspace folder and depending on every member.
If the root `Cargo.toml` also defines a crate, that crate's project hosts these
targets and no extra project appears. Formatting is per crate: every crate has
its own `fmt` and `fmt-check`. The targets are listed under
[Targets](targets.mara.md#workspace-level-targets).

That project also has the `lockfile` task. It lets cargo bring the
workspace's `Cargo.lock` up to date and turns it into one digest per crate.
Every cached task of a crate waits for it and reads the crate's digest, so a
dependency update reruns only the crates it reaches
([Caching](caching.mara.md#lockfile-changes)).

The workspace project is named after its folder's path from the root of the Nx
workspace, with each `/` replaced by `-`: a workspace in `rust/` gives `rust`,
one in `services/billing/` gives `services-billing`. A workspace at the root of
the Nx workspace itself is called `cargo-workspace`. A workspace's name prefix
applies to its crates, not to this project. To choose another name, or to give
the project tags or targets of its own, use the `project` table of the
workspace's metadata:

```toml
# services/billing/Cargo.toml
[workspace]
members = ["crates/*"]

[workspace.metadata.nx.project]
name = "billing-rust"
tags = ["scope:billing"]

[workspace.metadata.nx.project.targets.sqlx-prepare]
command = "cargo sqlx prepare --workspace"
```

The table is for a workspace whose root `Cargo.toml` defines no crate. When it
does, that crate's project is the workspace project, and its name and targets
go into `[package.metadata.nx]`; a `project` table there is an error.

Names are used as they are. A folder name that contains `,` or `:`, or starts
with `!`, gives a name that is awkward on Nx's command line: `,` and a leading
`!` change what `--projects` selects, and `:` separates the project from the
target in `nx run`. Set a name in the table to avoid that.

If the workspace folder already is an Nx project, because it has a
`project.json` or a `package.json` that Nx reads, Nx makes the two one project.
Nx reads a `package.json` when your package manager's workspace patterns
include it or a `project.json` sits beside it, and the root one also when it
has an `nx` key. Where Nx takes the name from the folder's `project.json` or
`package.json`, the `name` in the table has no effect: a `project.json` that
sets a name gives the name, and otherwise the `package.json` does. A
`project.json` without a name and without a `package.json` beside it keeps the
name from the table, or the default. At the root of the Nx workspace, a
`project.json` without a name, an `nx` key in the root `package.json` or a
workspace pattern that includes the root is enough to give the project the name
in the root `package.json`.

A workspace project with the same name as a crate, or two workspace projects
with one name, make the graph fail: Nx's error names both folders, and
nx-rust's error names both manifests, though not always for a project at the
root of the Nx workspace.
Default names can collide: a workspace in `services/billing/` and one in
`services-billing/` both get `services-billing`, and one at the root and one in
`cargo-workspace/` both get `cargo-workspace`. Set a `name` in the table of one
of them. A workspace project and a JS project with one name make Nx fail with
its own error.

You reach the workspace project by its name, as in `nx run rust:audit`, or with
the others through `nx run-many -t audit`. Nx also accepts its folder in place
of the name unless the folder's text matches a project name, as in
`nx audit services/billing`, and inside the folder `nx audit` is enough; at the
root of the Nx workspace, `nx audit .` works too.

## The dependency graph

- **All three kinds of Cargo dependency are edges:** normal, build and
  dev-dependencies. A change in a crate that another crate uses only in its
  tests still invalidates that crate's cached tests.
- **A path dependency into another workspace** is an edge to the one project
  that crate already has. The crate stays in its home workspace, and its own
  tests run there.
- **Crates that `[patch]`, `[replace]` or `paths` put in place of a registry or
  git dependency** are dependencies too. The plugin reads these tables from the
  workspace's root `Cargo.toml` and from the `.cargo/config.toml` files that
  Cargo reads for the workspace, without running Cargo. A dependency whose
  name and version requirement the redirected crate matches gets its edge.
  Which other crates end up using a redirected crate is not in those files: a
  crates.io crate can lead to it. So every member with a registry or git
  dependency gets an edge to it, and the graph can show more edges than
  `cargo tree`, never fewer, apart from edges that would form a cycle, for
  which the crate's files count as inputs instead. A redirection in your
  Cargo home's `config.toml` counts too, with a warning, because Nx does not
  notice when a file outside the repository changes.
- **External crates are not nodes.** `nx graph` shows the crates of the
  repository only. A crate's cache key still follows the locked versions of
  the external crates it reaches, through the `lockfile` task of its workspace
  ([Caching](caching.mara.md#lockfile-changes)).
- **Cycles are kept.** Cargo allows a crate's dev-dependency to depend back on
  it. The edge stays in the graph. Nx fails only when tasks depend on each
  other in a cycle, and the plugin's targets do not depend on other crates'
  targets, only on the `lockfile` task of their workspace, which depends on
  nothing ([Targets](targets.mara.md)). If your own `dependsOn` creates such a
  cycle, Nx names the tasks involved.

## Requirements

:::mara requirement REQ-INFERRED-PROJECTS
:mid: 01M78FHG7FTJGK8AM848F0DHR4
:title: Infer an Nx project for every workspace member
:status: accepted
:satisfies: NEED-ZERO-CONFIG
:satisfies: NEED-CARGO-UNCHANGED

Every member of every discovered Cargo workspace is an Nx project rooted at the crate's folder. The name, targets and dependencies that the plugin gives it are derived from Cargo's own description of the workspace. Where the crate's folder also is a JS project, Nx applies its `package.json` and `project.json` after every plugin, so the name Nx takes from them and their scripts and targets named like the plugin's take precedence ([[EVD-NX-PROJECT-MERGE]]). The plugin neither requires nor creates a `project.json` or any other file inside a crate.
:::

:::mara requirement REQ-MULTI-WORKSPACE
:mid: 01M78FHG7FM0VMSF1ZZQBRH77A
:title: Support any number of Cargo workspaces anywhere
:status: accepted
:satisfies: NEED-ANY-LAYOUT

The plugin handles any number of Cargo workspaces located anywhere in the repository, including the repository root. A crate outside every workspace, and a crate that its enclosing workspace excludes, is handled as a workspace with one member ([[TERM-STANDALONE-CRATE]]). Everything Cargo scopes to a workspace is kept per workspace ([[TERM-WORKSPACE-CONTEXT]]), and finding the projects costs one cargo invocation per workspace for each plugin entry that receives its manifests.
:::

:::mara requirement REQ-CROSS-WORKSPACE-DEPS
:mid: 01M78FHG7F66H6NHB2TKC89D15
:title: Keep a crate one project across workspaces
:status: accepted
:satisfies: NEED-ANY-LAYOUT
:satisfies: NEED-AFFECTED

A crate that a member of another Cargo workspace uses through a path dependency is exactly one Nx project. It belongs to the workspace that lists it as a member, and its own tasks run there. The consuming crate has a dependency edge to it.
:::

:::mara requirement REQ-SKIP-CRATES
:mid: 01M78FHG7FG8P6G2HEZA4XB0FT
:title: Leave ignored, excluded and vendored crates alone
:status: accepted
:satisfies: NEED-ANY-LAYOUT

Crates under paths ignored by `.gitignore` or `.nxignore`, crates matched by `exclude` on the plugin's entry in `nx.json`, and crates whose folder holds cargo's `.cargo-checksum.json`, such as those that `cargo vendor` writes, that no workspace lists among its members, do not become Nx projects.
:::

:::mara requirement REQ-PROJECT-NAMES
:mid: 01M78FHG7FHKQE34YBKH1C5WSN
:title: Name projects after crates and fail on collisions
:status: accepted
:satisfies: NEED-ZERO-CONFIG

An Nx project is named after its crate. When the crate's folder also is a JS project, the name set by its `package.json` or `project.json` applies instead, because Nx applies those files after every plugin ([[EVD-NX-PROJECT-MERGE]]). A [[TERM-WORKSPACE-PROJECT]] that is not a crate's project is named after the path of the workspace folder from the root of the Nx workspace, and a workspace at that root has a fixed name; the same exception applies to its folder, and a name set for it in the workspace's metadata replaces the default ([[ADR-WORKSPACE-PROJECT-NAME]]). When two projects of this plugin get the same name, graph creation fails. Nx's own error names their folders, and where the plugin can tell that the colliding projects are its own it adds an error that names their manifest paths and the remedies ([[DES-PROJECT-GRAPH]]). The plugin never renames a project on its own. A per-crate name, a per-workspace name prefix and a name for the workspace project resolve a collision. Whatever the project is called, every cargo command addresses the crate by its real package name and manifest path.
:::

:::mara requirement REQ-WORKSPACE-PROJECT
:mid: 01M78FHG7FEH8W5X747EMPM5B1
:title: Give each workspace one project for workspace-level tasks
:status: accepted
:satisfies: NEED-ZERO-CONFIG
:satisfies: NEED-ANY-LAYOUT

Each Cargo workspace has exactly one Nx project for tasks that concern the workspace as a whole ([[TERM-WORKSPACE-PROJECT]]). It is rooted at the workspace folder and depends on every member. When the root manifest also defines a crate, that crate's project carries the workspace-level targets and no second project is created.
:::

:::mara requirement REQ-DEPENDENCY-EDGES
:mid: 01M78FHG7FCAFQC6190Y3J4B5A
:title: Put every kind of Cargo dependency in the graph
:status: accepted
:satisfies: NEED-AFFECTED
:satisfies: NEED-CORRECT-CACHE

The graph has an edge for every normal, build and dev-dependency between crates that are Nx projects. An edge is present even when it closes a cycle that Cargo permits. A crate that `[patch]`, `[replace]` or `paths` may put in place of a registry or git dependency counts as a dependency of every member that may use it, so the graph has at least the edges of the crates that Cargo builds; where such an edge would close a cycle that Cargo rejects, the member's cache keys cover the crate through inputs instead ([[ADR-REDIRECTION-EDGES]], [[REQ-INPUT-FILES]]).
:::

:::mara requirement REQ-EXTERNAL-DEPS
:mid: 01M78FHG7FCVSEDGQW30RSSCMA
:title: Invalidate a crate only for the external dependencies it uses
:status: accepted
:satisfies: NEED-AFFECTED
:satisfies: NEED-CORRECT-CACHE

A change in `Cargo.lock` changes a crate's cache keys when it changes a package among that crate's resolved dependencies, direct or transitive, as the lockfile of the crate's own workspace resolves them. A lockfile change that leaves a crate's resolved dependencies untouched does not change that crate's cache keys, and a change to the lockfile of another workspace never does. No result is stored or restored under a key computed from a lockfile that cargo would still change. After a change to a workspace's `Cargo.lock`, `nx affected` selects the cached targets of that workspace's crates, and those whose keys did not change are restored from the cache.
:::

:::mara requirement REQ-METADATA-DISK-CACHE
:mid: 01M78FHG7FM7J2WAZSP8WESWVG
:title: Reuse the cargo metadata report between Nx processes
:status: retired
:satisfies: NEED-EFFICIENT-BUILDS

The `cargo metadata` report of a workspace is reused across Nx processes for as long as the files it depends on are unchanged.

Retired on 13 November 2026: the report is requested afresh in every graph computation, because a stored report would save little and could go stale ([[ADR-NO-METADATA-CACHE]]).
:::

## Design

:::mara design DES-DISCOVERY
:mid: 01M78FHG7FJ3Z6F0AX0K80EH9D
:title: Workspace discovery
:status: accepted
:satisfies: REQ-MULTI-WORKSPACE
:satisfies: REQ-SKIP-CRATES

The plugin receives every `Cargo.toml` that Nx finds. Nx has already left out paths ignored by `.gitignore` and `.nxignore`, and the manifests matched by `exclude` on the plugin's entry in `nx.json`. That `exclude` is Nx's own filter for plugin entries ([[EVD-NX-24-INSPECTION]]); the plugin has no option of its own for it.

Discovery repeats one step until no manifest is unclaimed: take the shallowest unclaimed manifest and run `cargo metadata` in its folder. The report names the workspace root and its members, and those manifests are now claimed by that workspace. A manifest whose report has one member and no enclosing workspace is a [[TERM-STANDALONE-CRATE]]. A crate that an enclosing workspace excludes is still unclaimed after that workspace's step, so it gets a step of its own and becomes a standalone crate too. Each workspace costs one cargo call.

A member whose manifest was left out or removed gets no project, although the report lists it.

For each workspace, discovery also reads the crates that its `[patch]`, `[replace]` and `paths` tables redirect dependencies to, without cargo ([[DES-METADATA-REPORT]], [[ADR-REDIRECTION-EDGES]]).

A manifest whose folder also holds `.cargo-checksum.json` belongs to a package of a directory source, such as a crate that `cargo vendor` wrote, and discovery never reads it: the crate gets no project, no edge and no cargo call of its own, wherever its folder lies, whichever plugin entry receives the manifest and whatever Cargo's configuration says ([[ADR-SKIP-VENDORED-CRATES]]). A workspace whose report, requested for another manifest, lists such a crate among its members claims it like any member, as cargo enrols one that a member depends on by path, and the crate gets its project.

When cargo cannot be started, or `cargo metadata` fails for a manifest, graph creation fails with an error that names the manifest and carries cargo's message. A toolchain that the folder pins and that is not installed is such a failure, and rustup's message names the toolchain ([[DES-METADATA-REPORT]]). The plugin never leaves a workspace out of the graph to get past such a failure ([[ADR-CARGO-SOURCE-OF-TRUTH]]). A manifest matched by `exclude` gets no project and is not read as a workspace, but a crate that depends on it by path, or whose workspace's `[patch]` or `[replace]` redirects to it, still makes the plugin request one report for it, because its files are inputs of that crate.
:::

:::mara design DES-METADATA-REPORT
:mid: 01M78FHG7FMJF63PW3D02BH53E
:title: One cargo metadata report per workspace
:status: accepted
:satisfies: REQ-INFERRED-PROJECTS
:satisfies: REQ-MULTI-WORKSPACE

Nodes, targets and edges of a workspace all come from one `cargo metadata` report. Project creation and dependency creation (the plugin's `createNodes` and `createDependencies` hooks) of one plugin entry in `nx.json` share that report, so the two hooks cannot disagree and a graph computation runs cargo once per workspace for the entry. A workspace whose manifests two entries receive is reported once for each of them, because Nx runs each entry in a process of its own unless plugin isolation is off; entries in one process share the report ([[EVD-NX-PLUGIN-ENTRIES]]). Workspace and package metadata tables ([[DES-METADATA-TABLES]]) are read from the same report, not by parsing manifests. The report is requested afresh in every graph computation ([[ADR-NO-METADATA-CACHE]]).

The report is requested with `--no-deps` ([[ADR-METADATA-NO-DEPS]]). It then holds the members of the workspace with their targets, their declared dependencies and the metadata tables, and Cargo's two directories. It needs no network, downloads nothing and never creates or changes `Cargo.lock` ([[EVD-CARGO-NO-DEPS]]). A dependency on another crate in the repository is recognised by the path its entry carries. Dependencies are not resolved in this report, so the locked versions of external crates come from `Cargo.lock` itself ([[DES-LOCKFILE-HASHING]]). The lockfile task lets cargo bring that file up to date and reads it when it runs; graph creation does not read it.

**Redirections.** The report does not apply `[patch]`, `[replace]` or `paths`, and no report without dependency resolution holds them ([[EVD-CARGO-REDIRECTIONS]]). They are the one exception to reading everything from the report: the plugin parses Cargo's files for them itself ([[ADR-REDIRECTION-EDGES]]). For each workspace it reads the `[patch]` and `[replace]` entries with a `path` from the root manifest, and the `[patch]` entries with a `path` and the `paths` entries from the configuration of the workspace root, of every folder above it and of the Cargo home, following `include`. In each of these folders cargo reads `.cargo/config` where it exists and `.cargo/config.toml` otherwise, and in the Cargo home `config` or `config.toml` in the same way; these are the files that cargo reads for the workspace's tasks ([[DES-INVOCATION]]). A path resolves against the root manifest's folder, or in a configuration file against the folder above the one that holds the file. A `[patch]` in a member's manifest is ignored, as cargo ignores it. Reading runs no cargo and leaves `Cargo.lock` untouched. A root manifest or configuration file that cargo reads and the plugin cannot parse fails graph creation with an error that names it. A file that `include` names is skipped with a warning instead, because Cargo 1.91 ignores `include`.

A path dependency that is no member of the workspace appears only as that path. When such a crate has no project of its own, the plugin requests a report for its manifest as well, to learn the path dependencies behind it ([[DES-INPUTS]]), unless the crate's folder holds `.cargo-checksum.json` ([[DES-DISCOVERY]]). So it does for a crate without a project that a `[patch]` or `[replace]` entry redirects to, from the root folder of the workspace that redirects, comparing folders through symbolic links; an entry whose folder holds no `Cargo.toml` gets no report. When cargo fails for such a crate, as it does for a crate in a workspace's folder that is not its member, which cargo builds as a patch but does not report, graph creation goes on with a warning that names the manifest and carries cargo's message, and the path dependencies behind that crate are not followed. These calls come on top of the one per workspace.

Every cargo call of graph creation runs with `RUSTUP_AUTO_INSTALL=0`, set for these calls only, so a toolchain that is pinned for the folder the call starts in and that is not installed fails the call and graph creation instead of being installed ([[ADR-GRAPH-NO-TOOLCHAIN-INSTALL]]). rustup and Cargo choose the toolchain file and the configuration files by that folder ([[DES-INVOCATION]]). A workspace's report is requested once, in the folder of the first of its manifests that discovery reads, the shallowest one that Nx hands to the plugin ([[DES-DISCOVERY]]); that is the folder of the root manifest whenever Nx hands the root manifest to the plugin, where the workspace's tasks run as well. When Nx does not, because the root manifest is ignored or excluded while members are not, the report runs in a member's folder and the toolchain file that applies there decides the toolchain, so a toolchain pinned there and not installed fails graph creation with the same error. The report of a path dependency without a project starts in the root folder of the workspace whose member depends on it, directly or through other such crates.
:::

:::mara design DES-PROJECT-GRAPH
:mid: 01M78FHG7F2S7FX77PNWS621D6
:title: Projects, names and edges
:status: accepted
:satisfies: REQ-INFERRED-PROJECTS
:satisfies: REQ-PROJECT-NAMES
:satisfies: REQ-CROSS-WORKSPACE-DEPS
:satisfies: REQ-WORKSPACE-PROJECT
:satisfies: REQ-DEPENDENCY-EDGES

**Projects.** Each claimed member becomes a project rooted at the crate directory. Its name is the crate's `name` override when one is set, used as it is. Otherwise it is the package name, with the workspace's `namePrefix` put in front of it as it is, without a separator, when the workspace sets one, also for the crate of the root manifest ([[DES-METADATA-TABLES]]). In a folder that also is a JS project, Nx replaces that name with the one from `package.json` or `project.json` ([[EVD-NX-PROJECT-MERGE]]). Two projects of this plugin that hold one name once Nx has applied those files, whether crates or workspace projects, fail graph creation, and so does a collision with another plugin's project. Whether projects keep one name is known only once Nx has merged the projects of all plugins and of all entries of this plugin in `nx.json`, so each entry checks the names in `createDependencies`, against the merged projects that the hook receives. A project holds the name it has there, or, where another project took that name from it, the name under which Nx lists the files of its folder; a name that a `package.json` or `project.json` gave a project replaces the plugin's. To recognise another entry's projects there, each project carries in its metadata, under `cargo`, the name the plugin gives it, its manifest, the root manifest of its workspace and, for a crate, the package name and, as `nameOverride`, whether the crate's own `name` gave the name. Nx reports two projects with one name itself while it merges them, before it calls `createDependencies`, so its error "The following projects are defined in multiple locations", which names every folder, comes first. Commands never use the Nx name: they pass the real package name and the manifest path.

The plugin's own error names the manifest paths and the remedy for each: the crate's `name` override or the workspace's prefix for a crate, only the override for a crate that sets one, because the prefix does not change its name, and the `name` in `[workspace.metadata.nx.project]` for a workspace project. It is promised for two projects that collide under the names the plugin gave them, in one entry or across two entries that receive different manifests. Elsewhere it is best effort: when a project that is not the plugin's holds the name too, when three or more projects hold it, when the common name comes from `package.json` or `project.json` files, when entries of the plugin receive the same manifests, or when one of the projects is at the repository root, the message can be missing, can name only some of the manifests, or can appear once per entry. In every case graph creation fails with Nx's error, which names every folder.

**Workspace project.** Each workspace gets one project rooted at the workspace folder, with a dependency on every member. If the root manifest has a `[package]` table, no extra project is created and the workspace-level targets attach to that crate's project, which is named like any crate; a `[workspace.metadata.nx.project]` table in that manifest fails graph creation with an error that names the manifest and points to `[package.metadata.nx]`. Otherwise the project is named after the path of the workspace folder from the root of the Nx workspace, with each `/` replaced by `-` and nothing else changed: `rust/` gives `rust` and `services/billing/` gives `services-billing`. A workspace at the root of the Nx workspace is called `cargo-workspace`. Two folders can give one default name, such as `services/billing/` and `services-billing/`, or the root and `cargo-workspace/`; that fails as a collision between two projects of this plugin. The `name` in `[workspace.metadata.nx.project]` replaces this default, and the workspace's prefix does not apply to it ([[DES-METADATA-TABLES]], [[ADR-WORKSPACE-PROJECT-NAME]]). When the workspace folder already is an Nx project, through a `project.json` or a `package.json` that Nx reads, Nx merges the two into one project. Nx reads a `package.json` when the package manager's workspace patterns include it or a `project.json` sits beside it, and the root one also when it has an `nx` key. A `project.json` that sets a name gives the name. Otherwise a `package.json` in the folder gives it, and a `project.json` without a name is enough to make Nx read that file. Only a `project.json` without a name and without a `package.json` beside it leaves the plugin's name. A `name` in the sub-table has no effect where Nx renames the project ([[EVD-NX-PROJECT-MERGE]], [[EVD-WORKSPACE-PROJECT-NAMES]]). The edges from the workspace project to its members name it by the project Nx has at the workspace folder, as listed in the projects that `createDependencies` receives.

**Edges.** For each member, every dependency of kind normal, build or dev that resolves to a crate with an Nx project becomes an edge. That includes a path dependency on a member of another workspace: the target crate keeps its single project in its home workspace, where its own targets run in that [[TERM-WORKSPACE-CONTEXT]]. A path dependency on a crate without an Nx project produces no edge; its files reach the cache key as inputs ([[DES-INPUTS]]). Each edge names its two projects by the name Nx gives the project at the crate's root, as listed in the projects that `createDependencies` receives, because a `package.json` or `project.json` may have renamed it ([[EVD-NX-PROJECT-MERGE]]). Edges have Nx's type `implicit`, which names no source file, so that Nx takes them as returned on every graph computation: for the other types, Nx puts back the file dependencies it cached in an earlier computation for each file whose hash is unchanged, and a crate's edges depend on more than its own manifest ([[EVD-NX-EDGE-CACHE]]). The maintainer accepted the cost on 13 November 2026: `nx graph` labels the edges implicit and shows no file for them, and the default dependency reading of Nx release skips implicit edges, which the release work has to handle (nxr-jhdr3x).

**Redirected crates.** A workspace's redirections name crates ([[DES-METADATA-REPORT]]): the crate in the folder of a `[patch]` or `[replace]` entry, and every crate at or below the folder of a `paths` entry, matched to projects by their real folders, through symbolic links ([[ADR-REDIRECTION-EDGES]]).

- _Direct._ A dependency is redirected when its package name is the redirected crate's, the entry applies to its source (`crates-io`, the URL of a `[patch."<url>"]`, the URL of a `[replace]` specification, which is crates.io without one, or any source for `paths`), and the crate's version, from its report, satisfies the requirement. Cargo resolves it to that crate, so the edge is as real as a path dependency's. A member gets it for its own dependencies of every kind, and for those of the crates it reaches through normal or build dependencies without passing another member of the workspace, which has edges of its own. A requirement or a source that the plugin cannot evaluate, such as a pre-release or a registry named in `[patch.<name>]`, makes the dependency possible, not direct.
- _Possible._ A member that has a registry or git dependency, of its own or of a path crate that it reaches through normal or build dependencies, and no direct redirection to a redirected crate, gets an edge to it all the same, because a registry or git crate can lead there. The edge is left out where the redirected crate already reaches the member through real dependencies of kind normal or build, that is path dependencies and direct redirections, and where two redirected crates may only possibly use each other: cargo would reject the first as a cycle and can have at most one direction of the second. The member's targets then get the crate's files as an input instead ([[DES-INPUTS]]).

The edges are thereby a superset of the crates that cargo builds for a member ([[EVD-CARGO-REDIRECTIONS]]). The member itself is never its own target, and a redirected crate without a project gives no edge, only the input.

**External crates.** The graph has no node for an external crate ([[ADR-LOCKFILE-TASK]]). A crate's locked dependencies reach its cache key through the lockfile task of its workspace ([[DES-LOCKFILE-HASHING]]).

**Cycles.** A dev-dependency edge that closes a cycle is kept ([[ADR-ALL-DEP-KINDS]]), and so is an edge to a redirected crate, apart from those the paragraph on redirected crates leaves out. The plugin's targets declare no dependencies on other crates' targets except the lockfile task, which depends on nothing ([[REQ-NO-RUST-TASK-DEPS]]), so a project cycle does not become a task cycle through them.
:::

:::mara design DES-LOCKFILE-HASHING
:mid: 01M78FHG7FQWJY49AGS0FVGY2D
:title: Per-crate lockfile hashing through a lockfile task
:status: accepted
:satisfies: REQ-EXTERNAL-DEPS

Each Cargo workspace has one target, the lockfile task, that lets cargo bring `Cargo.lock` up to date and then writes a digest of it for each crate. It is named `lockfile` unless `targetNames` renames it, and it belongs to the [[TERM-WORKSPACE-PROJECT]], which is the root crate's project when the root manifest is a package ([[DES-WORKSPACE-TARGETS]]). The graph has no external nodes ([[ADR-LOCKFILE-TASK]]).

**Task.** The lockfile task is not cached. Each time it runs, it runs `cargo update --workspace` in the workspace root, with `--locked` in locked mode ([[DES-INVOCATION]]), and then writes the digests from the `Cargo.lock` that cargo leaves. Cargo leaves a current lockfile untouched, and it updates a stale one, or creates a missing one, byte for byte as the crates' own cargo commands would ([[EVD-CARGO-LOCK-CHECK]]). In locked mode cargo fails on a stale or missing lockfile and changes nothing. When cargo fails, for that or any other reason, the task fails with cargo's message, and Nx runs none of the tasks that depend on it ([[DES-DIAGNOSTICS]]). The task uses an executor without a batch implementation, so it never joins a batch ([[TERM-GROUP]]). It must not be cached, because whether cargo changes the lockfile also depends on files outside the repository, such as a `[patch]` in the cargo home's configuration, which Nx cannot hash ([[EVD-NX-24-LOCKFILE-UPDATE]]).

**Inputs.** The task's inputs only decide what `nx affected` selects: `Cargo.lock` as a fileset that includes git-ignored files, the root `Cargo.toml`, the `Cargo.toml` of every member and of every path package inside the repository, and the configuration files that [[DES-INPUTS]] lists as workspace files. The manifests are named from the repository root, because a pattern under the workspace project's root misses the files of the nested crate projects ([[EVD-NX-24-LOCKFILE-UPDATE]]).

**Digest.** For each member, the task writes a SHA-256 over the part of the lockfile's graph that the member's entry reaches. The walk starts at the member's entry, takes every dependency an entry lists, passes through path packages and follows `replace = …` to the entry it names. A reference without a source that two entries share by name and version means the entry without a source. `[[patch.unused]]` entries stay out. Each reachable entry gives one line: its name, version, source, checksum and `replace` value, then the strings of its `dependencies` list as the lockfile writes them, in byte order, all joined by tab characters, with an empty field for a value the entry lacks. The digest is the SHA-256 of these lines in byte order, each ended by a line feed, in UTF-8. The dependency strings count, because two current lockfiles can lock the same packages and differ only in which version of a package another package uses ([[EVD-CARGO-LOCK-CHECK]]). The lockfile locks a member with all its features, platforms and dependency kinds, and while cargo calls the lockfile current, the packages cargo compiles for the crate lie in that closure ([[EVD-CARGO-LOCK-CHECK]]). The digest holds no features; those a crate asks for reach its key through its manifest and its target options ([[DES-INPUTS]]).

**Where the digests live.** The digests are the task's outputs, in one folder per workspace under `.nx/workspace-data/nx-rust/lockfile/` in the repository. Nx hashes a dependency's output only inside the repository ([[EVD-NX-24-LOCKFILE-TASK]]). `nx init` writes `.nx/workspace-data` into `.gitignore`, and Nx always leaves that folder out of its file map ([[EVD-NX-24-SETUP]]).

**Crate targets.** Every cached target of a member other than `fmt-check` depends on the lockfile task of the member's workspace and hashes the member's digest through a `dependentTasksOutputFiles` input; `doc` hashes the digests of all members ([[DES-INPUTS]]). None of them has `Cargo.lock` as a plain file input: Nx hashes such a task before the run starts, before the lockfile task can rewrite the file, and restores the result for the old lockfile ([[EVD-NX-24-LOCKFILE-UPDATE]]). `fmt` and `fmt-check` do not depend on the lockfile task, because `cargo fmt` reads no lockfile ([[EVD-CARGO-LOCK-CHECK]]). A crate that a member of another workspace uses by path runs its tasks in its home workspace, keyed on that workspace's digest. The consumer's digest covers that crate's dependencies as the consumer's lockfile resolves them.

**Post-check.** After the cargo call of a cached task that depends on the lockfile task, in a batch after the call of its group, the executor computes the crate's digest again from `Cargo.lock`. When it differs from the digest file the task's key was computed from, the task fails, so that Nx stores nothing, as for the check of [[DES-BUILD-INPUT-CHECK]], which runs in the same step. That happens when a manifest or the lockfile changed while the run went on ([[EVD-NX-24-LOCKFILE-UPDATE]]).

**Excluded dependencies.** A command run with `--exclude-task-dependencies` runs no lockfile task, and a crate task's digest input then contributes nothing to its key ([[EVD-NX-24-LOCKFILE-UPDATE]]). The plugin's `preTasksExecution` hook, the one that [[DES-UNKNOWN-OPTIONS]] uses, parses the command's arguments as Nx does. It sets `NX_RUST_RUN_ID` to a value that no other run has when they exclude task dependencies, and to the empty string otherwise. Every cached crate target that depends on the lockfile task has that variable as an `env` input, so such a run runs those tasks, nothing it stores is restored again, and a normal run keeps its keys. A target default that replaces a crate target's `dependsOn` drops the lockfile task in the same way, and [[DES-TARGET-DEFAULT-GUARD]] reports it as an error.

**nx affected.** A change to `Cargo.lock` or to a manifest selects the lockfile task through its inputs and, through its output, every cached target of the workspace's crates that depends on it. Those whose digest did not change are restored from the cache ([[EVD-NX-24-LOCKFILE-UPDATE]]).

**Batching.** Nx runs the lockfile task before the crate tasks of its workspace, which then become runnable together and form their groups as [[DES-BATCH]] describes ([[EVD-NX-24-LOCKFILE-TASK]]).

**Root package.** When the root manifest is a package, `Cargo.lock` lies in that crate's folder, as it does in the folder of every [[TERM-STANDALONE-CRATE]]. The crate's own files leave it out ([[DES-INPUTS]]), so that it reaches the keys of that crate and of the crates that depend on it only through the digests ([[EVD-NX-24-LOCKFILE-TASK]]).

**Workspace-level targets.** `audit`, `deny` and `update`, which are not cached, take the whole `Cargo.lock` as a file input together with the configuration of their tool; that input only decides what `nx affected` selects ([[DES-WORKSPACE-TARGETS]]).

**Merged project.** When the workspace folder also is an Nx project, a `package.json` script or a `project.json` target with the lockfile task's name replaces it, as it replaces any inferred target ([[EVD-NX-PROJECT-MERGE]], [[RISK-MIXED-PROJECT-MERGE]]). Renaming the lockfile task through `targetNames` avoids that; what the plugin does about replaced targets belongs to [[REQ-MIXED-PROJECTS]].

**Redirected crates.** A `paths` override, and the contents of a path package that a crate reaches only through `[patch]` or `[replace]`, leave no trace in the digest; the edges to redirected crates bring their files into the keys of the members that may use them through `^` inputs ([[DES-PROJECT-GRAPH]], [[ADR-REDIRECTION-EDGES]]).
:::
