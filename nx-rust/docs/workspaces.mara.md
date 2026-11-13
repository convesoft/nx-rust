# Workspaces and projects

> **Status:** specified, not implemented yet.

nx-rust finds every Cargo workspace in the repository and turns each member
crate into an Nx project. You do not list crates anywhere: the plugin asks
Cargo.

```text
.
├── nx.json
├── apps/web/                  JS app                -> project "web"
├── rust/                      a Cargo workspace     -> the workspace project
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
including the repository root, and there can be any number of them.

- A crate outside every workspace is a **standalone crate**: a workspace of
  one, with its own `Cargo.lock` and its own build directory. The plugin does
  not hide that, so two standalone crates share no compiled dependencies.
- A crate that its workspace lists under `exclude` is also a standalone crate.
- Crates under paths ignored by `.gitignore` or `.nxignore` are skipped. Use
  `exclude` on the plugin's entry in `nx.json` for vendored or generated crates
  that are checked in ([Configuration](configuration.mara.md)). A crate that depends by
  path on a skipped crate still gets that crate's files into its cache key
  ([Caching](caching.mara.md)).
- If cargo is not installed, or `cargo metadata` fails for a manifest, the
  graph fails with cargo's message. Nothing is left out silently, so every
  machine that runs `nx` in the repository needs cargo
  ([Setup](setup.mara.md)).
- Building the graph needs no network and downloads no crates. The plugin asks
  Cargo only about the workspace itself (`cargo metadata --no-deps`), which
  also never touches `Cargo.lock`.

Everything Cargo scopes to a workspace stays per workspace: the lockfile, the
build directory, the toolchain, the batches and the coverage baseline. That is
why a cache input is a real path such as `rust/Cargo.lock`, never one
repository-wide name for "the lockfile".

## Project names

A project is named after its crate. If two crates in the repository have the
same name, the graph fails with an error that names both manifests:

```toml
# tools/api/Cargo.toml - a second crate called "api"
[package.metadata.nx]
name = "tools-api"
```

A per-workspace prefix does the same for all members of a workspace. Renaming
the project changes nothing for Cargo: every command still uses the real
package name and manifest path.

A crate whose folder is also a JS project takes that project's name, from its
`package.json` or its `project.json`, because Nx applies those files after
every plugin. The crate's `name` override has no effect there. To choose
another name, set `name` in the folder's `project.json` if it has one, and
otherwise `nx.name` in its `package.json`. A crate and a JS project with the
same name make Nx fail with its own error, which names both folders.

## Workspace-level tasks

Some tasks belong to a workspace, not to one crate: documentation, `cargo audit`,
`cargo deny`, lockfile updates and coverage collection. Each workspace has one
project for them, rooted at the workspace folder and depending on every member.
If the root `Cargo.toml` also defines a crate, that crate's project hosts these
targets and no extra project appears. Formatting is per crate: every crate has
its own `fmt` and `fmt-check`. The targets are listed under
[Targets](targets.mara.md#workspace-level-targets).

That project also has the `lockfile` task, which turns the workspace's
`Cargo.lock` into one digest per crate. Every cached task of a crate waits for
it and reads the crate's digest, so a dependency update reruns only the crates
it reaches ([Caching](caching.mara.md#lockfile-changes)).

## The dependency graph

- **All three kinds of Cargo dependency are edges:** normal, build and
  dev-dependencies. A change in a crate that another crate uses only in its
  tests still invalidates that crate's cached tests.
- **A path dependency into another workspace** is an edge to the one project
  that crate already has. The crate stays in its home workspace, and its own
  tests run there.
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

Every member of every discovered Cargo workspace is an Nx project whose name, root, targets and dependencies are derived from Cargo's own description of the workspace. The plugin neither requires nor creates a `project.json` or any other file inside a crate.
:::

:::mara requirement REQ-MULTI-WORKSPACE
:mid: 01M78FHG7FM0VMSF1ZZQBRH77A
:title: Support any number of Cargo workspaces anywhere
:status: accepted
:satisfies: NEED-ANY-LAYOUT

The plugin handles any number of Cargo workspaces located anywhere in the repository, including the repository root. A crate outside every workspace, and a crate that its enclosing workspace excludes, is handled as a workspace with one member ([[TERM-STANDALONE-CRATE]]). Everything Cargo scopes to a workspace is kept per workspace ([[TERM-WORKSPACE-CONTEXT]]), and finding the projects costs one cargo invocation per workspace.
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
:title: Leave ignored and excluded crates alone
:status: accepted
:satisfies: NEED-ANY-LAYOUT

Crates under paths ignored by `.gitignore` or `.nxignore`, and crates matched by `exclude` on the plugin's entry in `nx.json`, do not become Nx projects.
:::

:::mara requirement REQ-PROJECT-NAMES
:mid: 01M78FHG7FHKQE34YBKH1C5WSN
:title: Name projects after crates and fail on collisions
:status: accepted
:satisfies: NEED-ZERO-CONFIG

An Nx project is named after its crate. When the crate's folder also is a JS project, the name set by its `package.json` or `project.json` applies instead, because Nx applies those files after every plugin ([[EVD-NX-PROJECT-MERGE]]). When two crates would get the same name, graph creation fails with an error that names both manifest paths; the plugin never renames a project on its own. A per-crate name and a per-workspace name prefix resolve a collision. Whatever the project is called, every cargo command addresses the crate by its real package name and manifest path.
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

The graph has an edge for every normal, build and dev-dependency between crates that are Nx projects. An edge is present even when it closes a cycle that Cargo permits.
:::

:::mara requirement REQ-EXTERNAL-DEPS
:mid: 01M78FHG7FCVSEDGQW30RSSCMA
:title: Invalidate a crate only for the external dependencies it uses
:status: accepted
:satisfies: NEED-AFFECTED
:satisfies: NEED-CORRECT-CACHE

A change in `Cargo.lock` changes a crate's cache keys when it changes a package among that crate's resolved dependencies, direct or transitive, as the lockfile of the crate's own workspace resolves them. A lockfile change that leaves a crate's resolved dependencies untouched does not change that crate's cache keys, and a change to the lockfile of another workspace never does. After a change to a workspace's `Cargo.lock`, `nx affected` selects the cached targets of that workspace's crates, and those whose keys did not change are restored from the cache. While a workspace has no `Cargo.lock`, the targets of its crates are not restored from the cache.
:::

:::mara requirement REQ-METADATA-DISK-CACHE
:mid: 01M78FHG7FM7J2WAZSP8WESWVG
:title: Reuse the cargo metadata report between Nx processes
:status: draft
:satisfies: NEED-EFFICIENT-BUILDS

The `cargo metadata` report of a workspace is reused across Nx processes for as long as the files it depends on are unchanged.

Open: which files the report depends on, where it is kept, and whether a disk cache is still worth having now that the report is requested with `--no-deps` and needs neither the network nor dependency resolution ([[DES-METADATA-REPORT]]). To measure on a large workspace. The design discussion of 12 November 2026 named this area without choosing a mechanism.
:::

## Design

:::mara design DES-DISCOVERY
:mid: 01M78FHG7FJ3Z6F0AX0K80EH9D
:title: Workspace discovery
:status: accepted
:satisfies: REQ-MULTI-WORKSPACE
:satisfies: REQ-SKIP-CRATES

The plugin receives every `Cargo.toml` that Nx finds. Nx has already left out paths ignored by `.gitignore` and `.nxignore`, and the manifests matched by `exclude` on the plugin's entry in `nx.json`. That `exclude` is Nx's own filter for plugin entries ([[EVD-NX-24-INSPECTION]]); the plugin has no option of its own for it.

Discovery repeats one step until no manifest is unclaimed: take the shallowest unclaimed manifest and run `cargo metadata` there. The report names the workspace root and its members, and those manifests are now claimed by that workspace. A manifest whose report has one member and no enclosing workspace is a [[TERM-STANDALONE-CRATE]]. A crate that an enclosing workspace excludes is still unclaimed after that workspace's step, so it gets a step of its own and becomes a standalone crate too. Each workspace costs one cargo call.

A member whose manifest was left out or removed gets no project, although the report lists it.

When cargo cannot be started, or `cargo metadata` fails for a manifest, graph creation fails with an error that names the manifest and carries cargo's message. The plugin never leaves a workspace out of the graph to get past such a failure ([[ADR-CARGO-SOURCE-OF-TRUTH]]). A manifest that should not be read is taken out with the `exclude` setting.
:::

:::mara design DES-METADATA-REPORT
:mid: 01M78FHG7FMJF63PW3D02BH53E
:title: One cargo metadata report per workspace
:status: accepted
:satisfies: REQ-INFERRED-PROJECTS
:satisfies: REQ-MULTI-WORKSPACE

Nodes, targets and edges of a workspace all come from one `cargo metadata` report. Project creation and dependency creation (the plugin's `createNodes` and `createDependencies` hooks) share that report, so a graph computation never runs cargo twice for one workspace and the two hooks cannot disagree. Workspace and package metadata tables ([[DES-METADATA-TABLES]]) are read from the same report, not by parsing manifests. Keeping the report between Nx processes is [[REQ-METADATA-DISK-CACHE]].

The report is requested with `--no-deps` ([[ADR-METADATA-NO-DEPS]]). It then holds the members of the workspace with their targets, their declared dependencies and the metadata tables, and Cargo's two directories. It needs no network, downloads nothing and never creates or changes `Cargo.lock` ([[EVD-CARGO-NO-DEPS]]). A dependency on another crate in the repository is recognised by the path its entry carries. Dependencies are not resolved in this report, so the locked versions of external crates come from `Cargo.lock`, which the lockfile task reads when it runs; graph creation only checks that the file exists ([[DES-LOCKFILE-HASHING]]).

A path dependency that is no member of the workspace appears only as that path. When such a crate has no project of its own, the plugin requests a report for its manifest as well, to learn the path dependencies behind it ([[DES-INPUTS]]). These calls come on top of the one per workspace.
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

**Projects.** Each claimed member becomes a project rooted at the crate directory. Its name is the package name, replaced by the crate's `name` override or extended by the workspace's prefix when set ([[DES-METADATA-TABLES]]). In a folder that also is a JS project, Nx replaces that name with the one from `package.json` or `project.json` ([[EVD-NX-PROJECT-MERGE]]). Two crates with one project name fail graph creation with an error naming both manifest paths and both remedies; a collision with another plugin's project fails with Nx's own error. Commands never use the Nx name: they pass the real package name and the manifest path.

**Workspace project.** Each workspace gets one project rooted at the workspace folder, with a dependency on every member. If the root manifest has a `[package]` table, no extra project is created and the workspace-level targets attach to that crate's project.

**Edges.** For each member, every dependency of kind normal, build or dev that resolves to a crate with an Nx project becomes an edge. That includes a path dependency on a member of another workspace: the target crate keeps its single project in its home workspace, where its own targets run in that [[TERM-WORKSPACE-CONTEXT]]. A path dependency on a crate without an Nx project produces no edge; its files reach the cache key as inputs ([[DES-INPUTS]]). Each edge names its two projects by the name Nx gives the project at the crate's root, as listed in the projects that `createDependencies` receives, because a `package.json` or `project.json` may have renamed it ([[EVD-NX-PROJECT-MERGE]]).

**External crates.** The graph has no node for an external crate ([[ADR-LOCKFILE-TASK]]). A crate's locked dependencies reach its cache key through the lockfile task of its workspace ([[DES-LOCKFILE-HASHING]]).

**Cycles.** A dev-dependency edge that closes a cycle is kept ([[ADR-ALL-DEP-KINDS]]). The plugin's targets declare no dependencies on other crates' targets ([[REQ-NO-RUST-TASK-DEPS]]), so a project cycle does not become a task cycle through them.
:::

:::mara design DES-LOCKFILE-HASHING
:mid: 01M78FHG7FQWJY49AGS0FVGY2D
:title: Per-crate lockfile hashing through a lockfile task
:status: accepted
:satisfies: REQ-EXTERNAL-DEPS

Each Cargo workspace has one cached target that turns its `Cargo.lock` into a digest per crate: the lockfile task, named `lockfile` unless `targetNames` renames it. It belongs to the [[TERM-WORKSPACE-PROJECT]], which is the root crate's project when the root manifest is a package ([[DES-WORKSPACE-TARGETS]]). The graph has no external nodes ([[ADR-LOCKFILE-TASK]]).

**Digest.** For each member, the task writes a SHA-256 over the name, version, source and checksum of every package that the member's entry in its workspace's `Cargo.lock` reaches. The walk passes through path packages, whether they are members, crates of other workspaces or crates without a project, and takes every dependency an entry lists. An entry lists normal, build and dev-dependencies, dependencies for other platforms and optional ones that nothing enables, so the digest covers whatever any feature set or platform compiles, and more is harmless. The source holds a git dependency's commit and the checksum a registry package's content ([[EVD-CARGO-LOCKFILE]]). The digest holds no features, because the lockfile records none; the features a crate asks for reach its key through the manifests and target options of [[DES-INPUTS]].

**Task.** The lockfile task reads `Cargo.lock` from disk when it runs, also when git ignores the file; graph creation does not read it ([[DES-METADATA-REPORT]]). Its inputs are the whole `Cargo.lock`, as a fileset that includes git-ignored files, because a plain fileset misses a change to an ignored lockfile and the task then restores the old digests ([[EVD-NX-24-LOCKFILE-TASK]]), and the plugin's own package ([[DES-INPUTS]]). It runs no cargo, depends on no task and uses an executor without a batch implementation, so it never joins a batch ([[TERM-GROUP]]). A `Cargo.lock` that it cannot parse fails the task with a message that names the file; cargo rejects such a file too.

**Where the digests live.** The digests are the output of the lockfile task, in a folder per workspace under `.nx/workspace-data/nx-rust/lockfile/` in the repository. No workspace's folder lies inside another's, because Nx restores a folder output by replacing it ([[EVD-NX-24-TARGETS]]). The folder must be inside the repository: Nx does not hash a dependency's output outside it, so a changed digest there leaves the crates' keys as they were ([[EVD-NX-24-LOCKFILE-TASK]]). `nx init` writes `.nx/workspace-data` into `.gitignore`, and the Nx daemon's watcher ignores it, so git sees no new file, and the folder lies outside every crate's sources and outside Cargo's directories, where plain cargo never looks ([[REQ-CARGO-UNCHANGED]]). The artifact directory was rejected: it can lie outside the repository, several workspaces can share it, and `cargo clean` empties it.

**Crate targets.** Every cached target of a member depends on the lockfile task of the member's workspace and hashes the member's digest through a `dependentTasksOutputFiles` input ([[DES-INPUTS]]). A crate that a member of another workspace uses by path runs its tasks in its home workspace, keyed on that workspace's digest. The consumer's own digest covers that crate's dependencies as the consumer's lockfile resolves them, so no key reads the lockfile of another workspace.

**nx affected.** Nx 24 selects tasks by changed files and works out moved external nodes only for JS lockfiles ([[EVD-NX-24-EXTERNAL-NODES]]). A changed `Cargo.lock` selects the lockfile task through its input and every task that reads its output, which is every cached target of the workspace's crates. Those whose digest did not change are restored from the cache ([[EVD-NX-24-LOCKFILE-TASK]]).

**Batching.** Nx runs the lockfile task before the crate tasks of its workspace, which then become runnable together and form their groups as [[DES-BATCH]] describes. A cache hit of the lockfile task only shortens the wait ([[EVD-NX-24-LOCKFILE-TASK]]).

**Root package.** When the root manifest is a package, `Cargo.lock` lies in that crate's folder, as it does in the folder of every [[TERM-STANDALONE-CRATE]]. The crate's own files then leave it out ([[DES-INPUTS]]): otherwise the whole lockfile would reach the crate's key and, through `^` inputs, the keys of every crate that depends on it ([[EVD-NX-24-LOCKFILE-TASK]]).

**Workspace-level targets.** The other targets of the workspace project take the whole `Cargo.lock` as a file input, together with the configuration of their tool ([[DES-WORKSPACE-TARGETS]]). For the uncached `audit`, `deny` and `update`, that input only decides what `nx affected` selects.

**No lockfile.** When the workspace root has no `Cargo.lock` as the graph is created, the targets of that workspace's crates run uncached, and the plugin says so ([[REQ-DIAGNOSTICS]]). The lockfile task then writes no digest. Once cargo has created the file, the next graph creation caches the targets again.

**Merged project.** When the workspace folder also is an Nx project, a `package.json` script or a `project.json` target with the lockfile task's name replaces the inferred task ([[EVD-NX-PROJECT-MERGE]], [[RISK-MIXED-PROJECT-MERGE]]). The crate targets then depend on that target and hash whatever lies at the digest path, so their keys no longer follow the lockfile. Renaming the lockfile task through `targetNames` avoids this; what the plugin does about replaced targets belongs to [[REQ-MIXED-PROJECTS]].
:::
