# nx-rust

`@convesoft/nx-rust` turns Cargo workspaces into Nx projects while Cargo stays
the build tool. Projects, targets and dependencies come from `cargo metadata`:
no crate needs a `project.json` or other Nx file of its own, and plain `cargo`
and rust-analyzer work as they would without the plugin.

The full documentation of this installed version is in the [`docs/`](docs/)
folder next to this file; start at [`docs/index.mara.md`](docs/index.mara.md).
Its `:::mara` blocks are the normative text. This page only points to them.

## Detection

The plugin is active when `nx.json` lists `@convesoft/nx-rust` under
`plugins`. The crates that the plugin discovers are then Nx projects: the
members of each Cargo workspace it finds, apart from crates that `include` or
`exclude` on the plugin's entry in `nx.json`, `.gitignore`, `.nxignore` or
`cargo vendor` leave out ([how workspaces are
found](docs/workspaces.mara.md#how-workspaces-are-found), [project
names](docs/workspaces.mara.md#project-names)). Where a workspace's root
manifest is read, the tasks for the whole workspace are on its root crate, or
on a project named after the workspace's folder where the root `Cargo.toml`
defines no crate ([workspace-level
tasks](docs/workspaces.mara.md#workspace-level-tasks)).

## Commands

Run tasks through Nx, prefixed with the workspace's package manager, rather
than through `cargo`, so that Nx can cache the targets that are cached (`run`
and `fmt`, among others, are not):

| Task                                       | Command                                          |
| ------------------------------------------ | ------------------------------------------------ |
| Lint, test and build what changed          | `nx affected -t lint test build`                 |
| One crate                                  | `nx test <project>`, `nx lint <project>`         |
| Type-check without building                | `nx check <project>`                             |
| Check or apply formatting                  | `nx fmt-check <project>`, `nx fmt <project>`     |
| Run a binary                               | `nx run <project>:run --bin=<name> --args="..."` |
| Release build                              | `nx build <project> --profile=release`           |
| See the cargo command of this run          | `nx test <project> --verbose --skip-nx-cache`    |
| Create a library crate                     | `nx g @convesoft/nx-rust:library <folder>`       |
| Create a binary crate                      | `nx g @convesoft/nx-rust:binary <folder>`        |
| A project's targets and the options it set | `nx show project <project>`                      |

Without `--skip-nx-cache`, a cache hit replays the stored output, which shows
a command only if the stored run was verbose
([seeing the command](docs/caching.mara.md#seeing-the-command)).

`lint` runs clippy. Rust formatting has no `nx format`: use `fmt-check` and
`fmt`. Workspace-level targets such as `doc`, `lockfile`, `audit` and `update`
are on the workspace project. All targets and when a crate has them are in
[targets](docs/targets.mara.md); the options each target accepts are in
[options of targets](docs/configuration.mara.md#options-of-targets).

## Configuration in `Cargo.toml`

The plugin's settings for a crate or workspace go in the `Cargo.toml` that
already describes it:

```toml
# rust/crates/api/Cargo.toml
[package.metadata.nx] # one crate
name = "backend-api"
tags = ["scope:backend"]
fileInputs = ["../../../proto/**/*.proto"] # relative to this Cargo.toml: <repo>/proto

[package.metadata.nx.targets.test.options]
features = ["integration"]
```

```toml
# rust/Cargo.toml
[workspace.metadata.nx] # every member of the workspace
testRunner = "nextest" # needs cargo-nextest installed
```

Repository-wide settings, such as `targetNames`, go into the plugin's
`options` in `nx.json`. An unknown key in those options or in the plugin's
`Cargo.toml` tables fails graph creation, and so does an unknown option under
`targets.<name>.options`; the other fields of a `targets.<name>` table go to
the Nx target as they are. Every setting and where it can go: [all
settings](docs/configuration.mara.md#all-settings).

Where a repository has them, a `project.json` or `package.json` in a crate's
folder and `targetDefaults` in `nx.json` take part too: Nx applies them after
the plugin, so they win over the `Cargo.toml` tables
([configuration](docs/configuration.mara.md)).

## Caching

- Nx caches task results and final artifacts only, never Cargo's build
  directory ([caching](docs/caching.mara.md#what-is-stored)).
- A cache key covers the crate's files, its dependencies, its locked
  packages, the toolchain and environment variables that change Rust builds,
  with exceptions per target and feature strategy
  ([what is in a cache key](docs/caching.mara.md#what-is-in-a-cache-key)).
- When a build script or test reads something the key does not cover,
  declare it: a file inside the repository with `fileInputs`, a variable with
  `envInputs`, and a file outside the repository or a command's output with
  `runtimeInputs`. A `fileInputs` pattern that leaves the repository fails
  graph creation
  ([files outside the crate](docs/caching.mara.md#files-outside-the-crate)).
- Leaving files out of a target's `inputs` is a promise that the target does
  not read them.
- Do not add `dependsOn: ["^build"]` to Rust targets: Cargo builds
  dependencies itself ([targets](docs/targets.mara.md#no-build-between-crates)).
