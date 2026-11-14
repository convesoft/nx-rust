# napi and wasm artifacts

> **Status:** specified, not implemented yet. Planned for milestone 0.4.

A Rust crate can be built into something a JS project consumes: a Node addon
through [napi-rs](https://napi.rs), or a wasm package through `wasm-bindgen`.
v1 supports both: Node addons for the host platform, and wasm for the browser.

| Target       | Produces                                                    | Flags                                                   |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple                   |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                                         |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm-bindgen's JS flavour: `web`, `bundler` or `nodejs` |

```sh
nx wasm-build image-codec
nx build web          # builds image-codec's wasm package first, if needed
```

## Which crates get these targets

The plugin reads it from the manifest. A library with
`crate-type = ["cdylib"]` gets `napi-build` when the crate depends directly on
`napi`, and `wasm-build` when it depends directly on `wasm-bindgen`. If the
rule guesses wrong for a crate, name the artifacts yourself in its own
`Cargo.toml` ([Configuration](configuration.mara.md#all-settings)):

```toml
[package.metadata.nx]
artifacts = ["wasm"] # or [] for none
```

## Depending on an artifact from JS

A JS project depends on the artifact target of the crate, not on `^build`:

```json
{
  "name": "web",
  "targets": {
    "build": {
      "dependsOn": [{ "projects": ["image-codec"], "target": "wasm-build" }]
    }
  }
}
```

If the JS target also declares `^build` and its project depends on the crate in
the project graph, Nx runs the crate's native `build` as well. The plugin cannot
prevent that ([Targets](targets.mara.md#no-build-between-crates)).

## Why separate target names

The rule: a different **kind** of artifact gets its own target name; a
different **flavour** of the same artifact is a flag.

- Nx's `dependsOn` names a target and cannot pin a configuration of it. A JS
  app can depend on `wasm-build`; it could not depend on "`build`, but the wasm
  configuration".
- `nx run-many -t build -c wasm` would run the default native build on every
  crate that has no wasm configuration.
- One configuration applies per invocation, so native plus wasm would take two
  commands.
- A named target exists only on crates that produce that artifact.

## How an artifact is built

Each artifact is built in two steps:

1. A plain cargo compile, which takes part in batching like any other build.
   A non-host triple such as `wasm32-unknown-unknown` is a group of its own and
   builds only the selected crates.
2. A post-processing step that Nx caches, with outputs outside Cargo's
   directories: the `wasm-bindgen` CLI for wasm, the napi CLI for Node addons.

The plugin calls `cargo build` and the `wasm-bindgen` CLI directly. It does not
use wasm-pack, whose home organisation was sunset in 2025.

## Things to know

- **Tool versions matter.** The `wasm-bindgen` CLI must match the version of
  the `wasm-bindgen` crate in your lockfile. Tool versions are part of the
  cache key.
- **Artifacts are platform-specific.** The target triple is part of the key, so
  a `.node` file built on Linux is never restored on macOS.
- **Generated files in the source tree** such as type definitions and JS glue
  are outputs of the target and are left out of its inputs.
- **One folder, two plugins.** A napi or wasm crate usually has `Cargo.toml`
  and `package.json` side by side, so this plugin and Nx's JS plugin describe
  the same project. Nx merges them into one project named by the
  `package.json` ([Project names](workspaces.mara.md#project-names)), and a
  script there with the name of an inferred target, such as `build` or `test`,
  replaces that target. What the plugin does about this is not specified yet
  ([[REQ-MIXED-PROJECTS]]).

Not in v1: cross-compiling Node addons to other platforms, wasm tests, and
publishing the resulting packages to npm.

## Requirements

:::mara requirement REQ-ARTIFACT-TARGETS
:mid: 01M78FHG7FP44K4K3TDR87ZFQS
:title: Build Node addons and wasm packages as named targets
:status: accepted
:satisfies: NEED-JS-BRIDGE

A crate that produces a Node addon has a `napi-build` target that builds the addon for the host triple, with its JS and type definitions. A crate that produces a wasm package has a `wasm-build` target that builds the package for the browser, with its JS glue. Each target exists only on crates that produce that artifact, and a JS project can depend on it by name. Which crates produce an artifact is inferred from their manifests, and a crate can state it explicitly instead.
:::

:::mara requirement REQ-ARTIFACT-CACHE
:mid: 01M78FHG7FWCZAQ21ZSKRABR4B
:title: Cache artifacts on everything that shapes them
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of an [[TERM-ARTIFACT-TARGET]] includes the target triple and the versions of the tools that post-process the build. Files that the target generates inside the source tree are outputs of the target and are not among its inputs. An artifact built for one platform is never restored on another.
:::

:::mara requirement REQ-MIXED-PROJECTS
:mid: 01M78FHG7FJ88KAM4MK9SZ4FZH
:title: Describe a folder with Cargo.toml and package.json as one project
:status: draft
:satisfies: NEED-JS-BRIDGE
:mitigates: RISK-MIXED-PROJECT-MERGE

A folder that holds both a `Cargo.toml` and a `package.json` is one Nx project that has the targets inferred by this plugin and those inferred by Nx's JS plugin, under a name the user can predict.

Open: what the plugin does about targets that `package.json` or `project.json` replaces, given that Nx names the project from those files and lets a same-named script or target replace an inferred one ([[EVD-NX-PROJECT-MERGE]]): keep the names and document `nx.includedScripts`, rename colliding inferred targets, or report the collision. Also open: how the dependency of a JS consumer on the crate enters the project graph, so that a change in the crate reaches the consumer, and what the consumer's own `^build` then runs on the crate ([[ADR-NO-RUST-BUILD-DEPS]]). The design discussion of 12 November 2026 did not cover this area.
:::

## Design

:::mara design DES-ARTIFACT-STEPS
:mid: 01M78FHG7F47NNMQ07P6DKD6KB
:title: Two steps per artifact
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS
:satisfies: REQ-ARTIFACT-CACHE

| Target       | Produces                                                    | Flags                                                  |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple                  |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                                        |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm-bindgen's JS flavour (`web`, `bundler`, `nodejs`) |

A different kind of artifact gets its own target name; a different flavour of the same artifact is a flag ([[ADR-ARTIFACT-TARGET-NAMES]]).

A crate produces an artifact when its library target has the crate type `cdylib` and the crate depends directly, through a normal dependency, on `napi` for a Node addon or on `wasm-bindgen` for a wasm package. A dependency declared for one platform only counts too. Both facts come from the `cargo metadata` report ([[DES-METADATA-REPORT]]), so the usual crate needs no configuration. An `artifacts` list in `[package.metadata.nx]` replaces the inference: it names the kinds the crate produces, and an empty list means none.

Each artifact target is built in two steps:

1. A plain cargo compile inside the batch ([[DES-BATCH]]). A non-host triple is its own group and builds only the selected crates ([[DES-FEATURE-SETS]]).
2. A post-processing task that Nx caches, with outputs outside Cargo's directories.

JS consumers depend on the artifact target, not on `^build`. Generated type definitions and JS glue are declared as outputs and excluded from inputs. The target triple is a target option and therefore in the key; the versions of the post-processing tools are runtime inputs.
:::

:::mara design DES-WASM
:mid: 01M78FHG7FEJ8068G4VR6C06QJ
:title: wasm-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`wasm-build` compiles the crate with `cargo build` for the wasm triple and then runs the `wasm-bindgen` CLI on the result. The JS flavour (`web`, `bundler` or `nodejs`) is a flag of the target. The CLI must match the version of the `wasm-bindgen` crate in the lockfile; a mismatch is reported before the step runs ([[REQ-DIAGNOSTICS]]). The plugin does not use wasm-pack ([[ADR-NO-WASM-PACK]]). v1 targets the browser and runs no wasm tests.
:::

:::mara design DES-NAPI
:mid: 01M78FHG7FRRT8J6Z5NYMT12A3
:title: napi-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`napi-build` compiles the crate with `cargo build` for the host triple and then runs the napi CLI to produce the `.node` file with its JS and type definitions. The versions of the napi CLI and of any cross toolchain are part of the cache key. v1 builds for the host triple only: cross-compiling takes one target per command and zig or cargo-xwin, and is normally a CI matrix.

Whether the napi CLI can post-process an existing cargo build, and whether napi crates need a special feature to link under `cargo test`, is not confirmed ([[RISK-NAPI-TOOLING]]).
:::

## Scenario

:::mara scenario SCN-MIXED-CHANGE
:mid: 01M78FHG7FZW8RSXABKCH37WF5
:title: A Rust change reaches the JS app that consumes it
:status: accepted

A repository has a web app `web` and a crate `image-codec` that is built into a wasm package; `web`'s build depends on `image-codec:wasm-build`. A developer changes a source file of `core`, a crate that `image-codec` depends on, and opens a pull request. CI runs `nx affected -t lint test build`. Nx runs `lint` and `test` for `core` and `image-codec`, runs `wasm-build` for `image-codec` because `web`'s build needs it, and builds and tests `web`. Unrelated crates and JS projects are restored from the cache or not selected at all. The Rust tasks of one workspace run with one cargo command per step of each group, not one per crate. No command in the pipeline is specific to Rust.
:::
