# nx-rust

`@convesoft/nx-rust` turns Cargo workspaces into Nx projects while Cargo stays
the build tool. Projects, targets and dependencies come from `cargo metadata`:
crates have no `project.json`, and plain `cargo` and rust-analyzer work as they
would without the plugin.

The full documentation of this installed version is in the [`docs/`](docs/)
folder next to this file; start at [`docs/index.mara.md`](docs/index.mara.md).
Its `:::mara` blocks are the normative text. This page only points to them.

## Detection

The plugin is active when `nx.json` lists `@convesoft/nx-rust` under
`plugins`. Each crate is then an Nx project, and each Cargo workspace has one
project for workspace-level tasks: its root crate, or a project named after
its folder where the root `Cargo.toml` defines no crate
([workspaces](docs/workspaces.mara.md)).

## Commands

Run tasks through Nx, prefixed with the workspace's package manager, rather
than through `cargo`, so that Nx can cache them:

| Task                                 | Command                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| Lint, test and build what changed    | `nx affected -t lint test build`                        |
| One crate                            | `nx test <project>`, `nx lint <project>`                |
| Type-check without building          | `nx check <project>`                                    |
| Check or apply formatting            | `nx fmt-check <project>`, `nx fmt <project>`            |
| Run a binary                         | `nx run <project>:run --bin=<name> --args="..."`        |
| Release build                        | `nx build <project> --profile=release`                  |
| See the cargo command a task runs    | `nx test <project> --verbose`                           |
| Create a crate                       | `nx g @convesoft/nx-rust:library <folder>` or `:binary` |
| List a project's targets and options | `nx show project <project>`                             |

`lint` runs clippy. Rust formatting has no `nx format`: use `fmt-check` and
`fmt`. Workspace-level targets such as `doc`, `lockfile`, `audit` and `update`
are on the workspace project. All targets, their options and when a crate has
them are in [targets](docs/targets.mara.md) and
[configuration](docs/configuration.mara.md#options-of-targets).

## Configuration in `Cargo.toml`

Overrides live in the `Cargo.toml` that already describes the crate or
workspace, not in Nx files:

```toml
[package.metadata.nx] # one crate
name = "backend-api"
tags = ["scope:backend"]
fileInputs = ["../../../proto/**/*.proto"] # relative to this Cargo.toml

[package.metadata.nx.targets.test.options]
features = ["integration"]

[workspace.metadata.nx] # every member of a workspace
testRunner = "nextest"
```

Repository-wide settings, such as `targetNames`, go into the plugin's
`options` in `nx.json`. An unknown key fails graph creation. Every setting and
where it can go: [configuration](docs/configuration.mara.md#all-settings).

## Caching

- Nx caches task results and final artifacts only, never Cargo's build
  directory ([caching](docs/caching.mara.md#what-is-stored)).
- A cache key covers the crate's whole folder, its dependencies, the
  lockfile, the toolchain and a fixed list of environment variables. When a
  build script or test reads a file, variable or command outside that list,
  declare it with `fileInputs`, `envInputs` or `runtimeInputs`
  ([what is in a cache key](docs/caching.mara.md#what-is-in-a-cache-key)).
- Leaving files out of a target's `inputs` is a promise that the target does
  not read them.
- Do not add `dependsOn: ["^build"]` to Rust targets: Cargo builds
  dependencies itself ([targets](docs/targets.mara.md#no-build-between-crates)).
