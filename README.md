# nx-rust

**`@convesoft/nx-rust` is an Nx plugin that makes Cargo workspaces first-class
Nx projects while Cargo stays the build tool.** It is written for monorepos
where Rust crates sit beside JS and TS projects.

> **Status:** the design is specified and the implementation has not started.
> The package is not published to npm yet. The specification is in
> [`nx-rust/docs/`](nx-rust/docs/index.mara.md), and progress is tracked in
> [`.zban/`](.zban/).

## Why

In a mixed monorepo Nx knows every JS project, but Rust is usually a set of
opaque scripts: no edges in the graph, no `nx affected`, and either no caching
or caching that cuts corners. nx-rust reads the Cargo workspaces as they are:

- **Nothing to describe twice.** Projects, targets and dependencies come from
  `cargo metadata`. No crate needs a `project.json`.
- **Cargo keeps working.** Plain `cargo` and rust-analyzer use the same
  directories and flags as before, and no files are generated inside crates.
- **A cache you can trust.** Cache keys cover every file of the crate, the
  sources of its dependencies, the toolchain and a fixed list of environment
  variables. Nx stores task results and final artifacts, never Cargo's
  intermediate files.
- **Few cargo invocations.** Nx schedules one task per crate, and the plugin
  runs them as one cargo call per group.
- **Rust and JS in one graph.** `nx affected -t lint test build` covers both
  languages, and napi and wasm crates produce artifacts that JS projects depend
  on.

See what nx-rust [deliberately does not do](nx-rust/docs/product.mara.md#what-nx-rust-deliberately-does-not-do).

## What it will look like

```sh
nx add @convesoft/nx-rust        # register the plugin; nothing is written into crates

nx show projects                 # every crate is a project
nx graph                         # with normal, build and dev-dependency edges
nx affected -t lint test build   # clippy, tests and builds, Rust and JS together
```

Overrides live in the `Cargo.toml` that already describes the crate:

```toml
[package.metadata.nx]
tags = ["scope:backend"]

[package.metadata.nx.targets.test.options]
features = ["integration"]
```

## Requirements

|       | Supported       |
| ----- | --------------- |
| Nx    | 24              |
| Cargo | 1.91 and later  |
| Host  | Linux and macOS |

Later Nx majors are added once the end-to-end tests pass on them. macOS is
supported, but CI covers Linux only for the moment. Every machine that runs
`nx` in the repository needs cargo, also for JS-only work.

## Roadmap

| Milestone | Contents                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| 0.1       | Project graph, inferred targets and caching, with one cargo call per task. `init` and crate generators. |
| 0.2       | Batching and feature unification.                                                                       |
| 0.3       | nextest, affected tests and the coverage baseline.                                                      |
| 0.4       | napi and wasm artifacts.                                                                                |
| 0.5       | Releasing with Nx release.                                                                              |
| 1.0       | The open assumptions are checked and closed.                                                            |

## Documentation

The [documentation](nx-rust/docs/index.mara.md) is both the user guide and the
engineering specification:

- [What nx-rust is](nx-rust/docs/product.mara.md)
- [Setup and compatibility](nx-rust/docs/setup.mara.md)
- [Workspaces and projects](nx-rust/docs/workspaces.mara.md)
- [Configuration](nx-rust/docs/configuration.mara.md)
- [Targets](nx-rust/docs/targets.mara.md)
- [Caching](nx-rust/docs/caching.mara.md)
- [Batching and features](nx-rust/docs/execution.mara.md)
- [Testing](nx-rust/docs/testing.mara.md)
- [napi and wasm artifacts](nx-rust/docs/artifacts.mara.md)
- [Releasing](nx-rust/docs/release.mara.md)
- [Continuous integration](nx-rust/docs/ci.mara.md)
- [Decisions and risks](nx-rust/docs/decisions.mara.md)
- [Verification](nx-rust/docs/verification.mara.md)

## Development

This repository is an Nx workspace managed with pnpm. The plugin is the
`nx-rust/` package, and `nx-rust-e2e/` holds its end-to-end tests. The
specification is maintained with [Mara](https://github.com/convesoft/mara) and
the backlog with [zban](https://github.com/convesoft/zban). Contributors and
coding agents start with [AGENTS.md](AGENTS.md).

```sh
pnpm install
pnpm nx run-many -t build lint test
pnpm nx e2e nx-rust-e2e          # publishes to a local registry and installs from it
pnpm nx format:check --all
mara schema validate && mara project validate
zban check
```

## License

nx-rust is available under your choice of the [MIT license](LICENSE-MIT) or the
[Apache License 2.0](LICENSE-APACHE).

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in nx-rust by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
