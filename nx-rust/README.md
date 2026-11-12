# @convesoft/nx-rust

An Nx plugin that makes Cargo workspaces first-class Nx projects while Cargo
stays the build tool. It is written for monorepos where Rust crates sit beside
JS and TS projects.

> **Status:** the design is specified and the implementation has not started.
> This package does nothing useful yet.

- **Nothing to describe twice.** Projects, targets and dependencies come from
  `cargo metadata`. No crate needs a `project.json`.
- **Cargo keeps working.** Plain `cargo` and rust-analyzer behave as they would
  without the plugin.
- **A cache you can trust.** Nx stores task results and final artifacts, never
  Cargo's intermediate files.
- **Few cargo invocations.** One cargo call per group of tasks.
- **Rust and JS in one graph.** `nx affected -t lint test build` covers both.

## Requirements

Nx 24, Cargo 1.91 or later, Linux or macOS. macOS is not covered by
CI yet.

## Usage

```sh
nx add @convesoft/nx-rust
nx affected -t lint test build
```

Overrides live in `Cargo.toml`:

```toml
[package.metadata.nx]
tags = ["scope:backend"]
```

## Documentation

The user guide and specification are in the repository:
<https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/index.mara.md>

## License

MIT OR Apache-2.0
