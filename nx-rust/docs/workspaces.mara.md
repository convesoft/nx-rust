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

## Workspace-level tasks

Some tasks belong to a workspace, not to one crate: formatting, `cargo audit`,
`cargo deny`, lockfile updates and coverage collection. Each workspace has one
project for them, rooted at the workspace folder and depending on every member.
If the root `Cargo.toml` also defines a crate, that crate's project hosts these
targets and no extra project appears.

## The dependency graph

- **All three kinds of Cargo dependency are edges:** normal, build and
  dev-dependencies. A change in a crate that another crate uses only in its
  tests still invalidates that crate's cached tests.
- **A path dependency into another workspace** is an edge to the one project
  that crate already has. The crate stays in its home workspace, and its own
  tests run there.
- **External crates** will appear as nodes with the prefix `cargo:`, one per
  direct dependency, so a crate's cache key can follow the dependencies it uses
  instead of the whole lockfile ([Caching](caching.mara.md)). They arrive
  together with per-crate lockfile hashing; until then the graph has no
  external nodes and the whole `Cargo.lock` is an input.
- **Cycles are kept.** Cargo allows a crate's dev-dependency to depend back on
  it. The edge stays in the graph. Nx fails only when tasks depend on each
  other in a cycle, and the plugin's targets do not depend on other crates'
  targets ([Targets](targets.mara.md)). If your own `dependsOn` creates such a
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

An Nx project is named after its crate. When two projects would get the same name, graph creation fails with an error that names both manifest paths; the plugin never renames a project on its own. A per-crate name and a per-workspace name prefix resolve a collision. Whatever the project is called, every cargo command addresses the crate by its real package name and manifest path.
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

Each crate depends in the graph on one [[TERM-EXTERNAL-NODE]] per direct external dependency. A change in `Cargo.lock` changes a crate's cache keys when it changes a package among that crate's resolved dependencies, direct or transitive. A lockfile change that leaves a crate's resolved dependencies untouched does not change that crate's cache keys.
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

The report is requested with `--no-deps` ([[ADR-METADATA-NO-DEPS]]). It then holds the members of the workspace with their targets, their declared dependencies and the metadata tables, and Cargo's two directories. It needs no network, downloads nothing and never creates or changes `Cargo.lock` ([[EVD-CARGO-NO-DEPS]]). A dependency on another crate in the repository is recognised by the path its entry carries. Dependencies are not resolved in this report, so the locked versions of external crates come from `Cargo.lock` itself ([[DES-LOCKFILE-HASHING]]).

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

**Projects.** Each claimed member becomes a project rooted at the crate directory. Its name is the package name, replaced by the crate's `name` override or extended by the workspace's prefix when set ([[DES-METADATA-TABLES]]). Two projects with one name fail graph creation with an error naming both manifest paths and both remedies. Commands never use the Nx name: they pass the real package name and the manifest path.

**Workspace project.** Each workspace gets one project rooted at the workspace folder, with a dependency on every member. If the root manifest has a `[package]` table, no extra project is created and the workspace-level targets attach to that crate's project.

**Edges.** For each member, every dependency of kind normal, build or dev that resolves to a crate with an Nx project becomes an edge. That includes a path dependency on a member of another workspace: the target crate keeps its single project in its home workspace, where its own targets run in that [[TERM-WORKSPACE-CONTEXT]]. A path dependency on a crate without an Nx project produces no edge; its files reach the cache key as inputs ([[DES-INPUTS]]).

**External nodes.** Each direct external dependency becomes a [[TERM-EXTERNAL-NODE]] with an edge from the crate. The nodes are created together with the mechanism that uses them for cache keys ([[DES-LOCKFILE-HASHING]]), not before: a node's identity has to tell apart two locked versions of one crate, and the same crate in the lockfiles of two workspaces, which the crate name alone cannot. Until then the graph has no external nodes.

**Cycles.** A dev-dependency edge that closes a cycle is kept ([[ADR-ALL-DEP-KINDS]]). The plugin's targets declare no dependencies on other crates' targets ([[REQ-NO-RUST-TASK-DEPS]]), so a project cycle does not become a task cycle through them.
:::

:::mara design DES-LOCKFILE-HASHING
:mid: 01M78FHG7FQWJY49AGS0FVGY2D
:title: Per-crate lockfile hashing through external nodes
:status: draft
:satisfies: REQ-EXTERNAL-DEPS

Each crate's cached targets take their external dependencies as an input through the crate's [[TERM-EXTERNAL-NODE]] edges, in place of the whole `Cargo.lock`.

The graph's report does not resolve dependencies ([[DES-METADATA-REPORT]]), so locked versions, sources and checksums are read from `Cargo.lock`.

Open: how a node's hash covers the locked version, source and checksum of the crate and of its transitive dependencies; what a node is called, so that two locked versions of one crate name, and one crate in the lockfiles of two workspaces, are told apart; whether enabled features belong in the hash; and how workspace-level tasks, which do depend on the whole lockfile, are keyed. Until this is specified, hashing the whole `Cargo.lock` is the safe fallback: it is correct but does not meet [[REQ-EXTERNAL-DEPS]].
:::
