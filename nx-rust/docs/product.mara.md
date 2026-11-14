# What nx-rust is

`@convesoft/nx-rust` is an Nx plugin that makes Cargo workspaces first-class Nx
projects while Cargo stays the build tool.

> **Status:** milestone 0.1 is implemented on `main` and not published to npm
> yet. The [roadmap](#roadmap) gives the order in which the other parts are
> built.

It is written for Nx monorepos where Rust crates sit beside JS and TS apps and
libraries. In such a repository Nx knows every JS project, but Rust is usually
a set of opaque scripts: no edges in the graph, no `nx affected`, and either no
caching or caching that cuts corners. nx-rust reads the Cargo workspaces as
they are:

- **Nothing to describe twice.** Projects, targets and dependencies come from
  `cargo metadata`. No crate needs a `project.json`.
- **Cargo keeps working.** Plain `cargo` and rust-analyzer use the same
  directories and flags as before, and the plugin puts no generated files into
  crates.
- **A cache you can trust.** A cache key covers the crate's files, the sources
  of its dependencies, the toolchain and a fixed list of environment variables.
  Nx stores task results and final artifacts, never Cargo's intermediate files.
- **Few cargo invocations.** Nx schedules one task per crate, and the plugin
  runs each group of tasks with one cargo command per step of their target: one
  for most targets, a few for a test run with nextest, never one per crate.
- **Rust and JS in one graph.** `nx affected -t lint test build` covers both
  languages, and napi and wasm crates produce artifacts that JS projects depend
  on.

Rust-only repositories work too, but they do not drive priorities.

## Principles

| Principle                                    | What it means                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Cargo is the source of truth                 | Projects, targets and dependencies come from `cargo metadata`.                       |
| Nx decides what runs and what is cached      | Cargo builds, in as few invocations as possible.                                     |
| Cargo owns its build directory               | Nx caches task results and final artifacts only.                                     |
| Cargo behaves as it would without the plugin | Same directories, same default flags, no generated files inside crates.              |
| Overrides live in `Cargo.toml`               | `[package.metadata.nx]` per crate, `[workspace.metadata.nx]` for workspace defaults. |
| Cache correctness over cache ambition        | Running more than a cache key promises is fine. Running less is not.                 |
| v1 targets a single machine                  | Rust tasks are not spread across CI agents.                                          |

## What v1 includes

- Any number of Cargo workspaces and standalone crates, anywhere in the
  repository, as Nx projects with a full dependency graph:
  [Workspaces and projects](workspaces.mara.md).
- Overrides in `Cargo.toml` and a few plugin options:
  [Configuration](configuration.mara.md).
- Inferred `build`, `check`, `lint`, `test`, `fmt-check`, `fmt`, `bench` and
  `run` targets for each crate, and `doc`, `audit`, `deny` and `update` for each
  Cargo workspace: [Targets](targets.mara.md).
- Cache keys and outputs that keep Cargo's build directory out of the Nx cache:
  [Caching](caching.mara.md).
- A few cargo commands per group of tasks instead of one per crate, with
  features resolved the same way on every run:
  [Batching and features](execution.mara.md).
- `cargo test` or nextest, and optional selection of affected tests:
  [Testing](testing.mara.md).
- Node addons and wasm packages as targets that JS projects depend on:
  [napi and wasm artifacts](artifacts.mara.md).
- Versioning and publishing crates with Nx release: [Releasing](release.mara.md).
- An `init` generator, crate generators and clear error messages:
  [Setup and compatibility](setup.mara.md).

## Roadmap

v1 is delivered in stages, completed on `main` one after another, and the work
is tracked as one epic per milestone in [`.zban/`](../../.zban/). No 0.x
milestone is published to npm on its own: whether and when the package is
published is decided at 1.0 ([[ADR-PUBLISHING-AT-1-0]]).

| Milestone | Contents                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| 0.1       | Project graph, inferred targets and caching, with one cargo call per task. `init` and crate generators. |
| 0.2       | Batching and feature unification.                                                                       |
| 0.3       | nextest, affected tests and the coverage baseline.                                                      |
| 0.4       | napi and wasm artifacts.                                                                                |
| 0.5       | Releasing with Nx release.                                                                              |
| 1.0       | The open assumptions listed under [risks](decisions.mara.md#risks) are checked and closed.              |

## What nx-rust deliberately does not do

- It does not install toolchains or tools. rustup, nextest, cargo-affected,
  cargo-hakari and the `wasm-bindgen` CLI stay your job; the plugin says clearly
  what is missing. Every machine that runs `nx` in the repository needs cargo.
- It does not build hermetically. There is no sandbox and no remote execution;
  the plugin trusts Cargo and a declared set of inputs.
- It does not store or restore Cargo's intermediate files.
- It does not need or generate a `project.json` per crate.
- It does not edit `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml`, except
  in generators, in release, and in tasks you run to change them.
- v1 does not run on Windows hosts.
- v1 does not cross-compile Node addons, run wasm tests, publish npm packages,
  run tests for other target triples, migrate a repository from
  `@monodon/rust`, format Rust through `nx format`, or spread Rust tasks across
  CI agents.

The reasons are recorded in [[ADR-V1-SCOPE]] and [[ADR-SINGLE-MACHINE]]. Adding
one of these needs a recorded need and decision before it is built.

## Goals

:::mara goal GOAL-CARGO-NATIVE
:mid: 01M78FHG7FRG7B5PSZD2NZ1ZAZ
:title: Keep Cargo the build tool and the source of truth
:status: accepted

Rust developers in an Nx monorepo keep working exactly as they would without the plugin. Cargo builds, the Cargo manifests describe the crates, and plain `cargo` and rust-analyzer behave the same with the plugin installed. Nothing about a crate has to be stated a second time for Nx, so the two descriptions cannot drift apart.
:::

:::mara goal GOAL-ONE-MONOREPO
:mid: 01M78FHG7F29A0KR2HCWPTFFZ1
:title: Treat Rust and JS as one monorepo
:status: accepted

In a repository that mixes JS/TS and Rust, one Nx graph, one cache, one `nx affected` and one set of commands cover both languages. A change in a Rust crate reaches the JS projects that consume it, and the other way round, without glue scripts.
:::

:::mara goal GOAL-TRUSTED-CACHE
:mid: 01M78FHG7F44E8BAFK3ZZJRQT7
:title: Never restore a wrong result
:status: accepted

A result restored from the Nx cache is the result the task would produce if it ran now. Teams can leave caching on in CI and on developer machines without re-running tasks to be safe. Where the plugin cannot be sure, it runs more work instead of restoring.
:::

:::mara goal GOAL-FAST-FEEDBACK
:mid: 01M78FHG7FME1CA6KC45BJAH4E
:title: Do as little Rust work as correctness allows
:status: accepted

A change triggers only the compilation and tests that it can affect, and that work costs about what a well-tuned plain cargo setup would cost. Developers and CI get Rust feedback in time proportional to the change, not to the size of the repository.
:::

## Needs

:::mara need NEED-ZERO-CONFIG
:mid: 01M78FHG7F6ZMMNWYB6PVC4PPT
:title: Use a Cargo workspace without describing it again
:status: accepted
:contributes_to: GOAL-CARGO-NATIVE
:contributes_to: GOAL-ONE-MONOREPO

A team can add the plugin to a repository and get Nx projects, targets and dependencies for its crates from the Cargo manifests it already has, without writing or generating per-crate Nx configuration.
:::

:::mara need NEED-ANY-LAYOUT
:mid: 01M78FHG7F1CQQA7RNG78E8109
:title: Keep the repository layout the team already has
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO

The plugin works with the Cargo layout a repository already has: one workspace or several, at the Nx root or in subfolders, standalone crates, crates excluded from a workspace, path dependencies between workspaces, and vendored or generated crates that should be left alone.
:::

:::mara need NEED-CARGO-UNCHANGED
:mid: 01M78FHG7FQRS21JJJXM330EJE
:title: Keep plain cargo and editor tooling working unchanged
:status: accepted
:contributes_to: GOAL-CARGO-NATIVE

A developer can run `cargo` directly and use rust-analyzer in a repository that has the plugin, and get the behaviour, directories and build reuse they would have without it. Work done through Nx and work done through plain cargo do not invalidate each other.
:::

:::mara need NEED-CONFIG-IN-CARGO
:mid: 01M78FHG7FKY2H96D624M0CEMJ
:title: Adjust the plugin where the crate is described
:status: accepted
:contributes_to: GOAL-CARGO-NATIVE

When a crate or workspace needs something other than the default, such as tags, another project name or different options for a target, a developer states it in the Cargo manifest that already describes that crate or workspace.
:::

:::mara need NEED-UNIFORM-COMMANDS
:mid: 01M78FHG7F03FJS926C86QPTPP
:title: Run Rust and JS tasks with the same commands
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO

The commands a mixed repository already uses for JS projects, such as `nx affected -t lint test build`, also cover its Rust crates, so developers and CI pipelines do not need a second set of commands for Rust.
:::

:::mara need NEED-CORRECT-CACHE
:mid: 01M78FHG7FMWW59PS4KPRKVCEJ
:title: Trust cached results
:status: accepted
:contributes_to: GOAL-TRUSTED-CACHE

Developers and CI can rely on a cache hit for a Rust task: everything that can change the task's result is part of what decides whether the cached result is reused, and a result of one kind is never reused as a result of another kind.
:::

:::mara need NEED-AFFECTED
:mid: 01M78FHG7F4CKFXTSBXJ7131EY
:title: Run only what a change affects
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK
:contributes_to: GOAL-ONE-MONOREPO

Given a change, developers and CI can run the tasks of the crates and JS projects it can affect, and skip the rest, across language boundaries. A change in a dependency, including one used only by tests or build scripts, counts as affecting its dependents.
:::

:::mara need NEED-EFFICIENT-BUILDS
:mid: 01M78FHG7F597HWJZPETAMWPQ4
:title: Avoid repeated and contended compilation
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK

Running many Rust tasks through Nx does not compile the same code several times, does not queue cargo processes behind one build lock, and does not rebuild because a different set of crates happened to run together.
:::

:::mara need NEED-FAST-TESTS
:mid: 01M78FHG7FX5BYGF6N2SGWAV2D
:title: Get test feedback proportional to the change
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK

A developer who changes a few lines in a large crate can get the results of the tests that the change can affect without waiting for the crate's whole suite, while the full suite still runs for every state of the main branch.
:::

:::mara need NEED-JS-BRIDGE
:mid: 01M78FHG7F1RBZVPETF1K490S9
:title: Consume Rust from JS projects
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO

A JS project can depend on a Rust crate that is built into a Node addon or a wasm package. Building the JS project builds the artifact first when needed, and a change in the crate affects the JS project.
:::

:::mara need NEED-RELEASE
:mid: 01M78FHG7F4QQYZSG4XA0NKA2W
:title: Version and publish crates with the rest of the repository
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO

A team that releases its JS packages with Nx release can version and publish its crates through the same process, with versions of dependent crates and the lockfile kept consistent.
:::

:::mara need NEED-EASY-SETUP
:mid: 01M78FHG7F7N61AHPME24567FE
:title: Start using the plugin without trial and error
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO

A team can add the plugin to an existing repository, and add new crates later, with one command each, and can tell from the documentation whether its Nx, Cargo and operating system are supported.
:::

:::mara need NEED-CLEAR-FAILURES
:mid: 01M78FHG7FV4WYX1Q7P92VTFTT
:title: Understand what is missing or misconfigured
:status: accepted
:contributes_to: GOAL-ONE-MONOREPO
:contributes_to: GOAL-TRUSTED-CACHE

When a tool is missing, a version is unsupported or a setting cannot work, the developer learns what is wrong, where, and what to do about it, before or instead of a confusing failure deep inside a build.
:::

## Vocabulary

:::mara term TERM-WORKSPACE-CONTEXT
:mid: 01M78FHG7FMWPZ9BFDB3SSSXM3
:title: Workspace context
:status: accepted

Everything that Cargo scopes to one Cargo workspace and that the plugin therefore handles per workspace: the lockfile, the build directory, the toolchain file, the batches and the coverage baseline. A repository has one workspace context per Cargo workspace, including each [[TERM-STANDALONE-CRATE]].
:::

:::mara term TERM-STANDALONE-CRATE
:mid: 01M78FHG7F37Z611RA86TV4DP2
:title: Standalone crate
:status: accepted
:aliases: workspace of one

A crate that is not a member of any Cargo workspace, either because no enclosing manifest declares a workspace or because the enclosing workspace excludes it. The plugin treats it as a workspace with one member, with its own lockfile and build directory.
:::

:::mara term TERM-WORKSPACE-PROJECT
:mid: 01M78FHG7F8DTF27C4K7XPZK6X
:title: Workspace project
:status: accepted
:aliases: synthetic project

The Nx project that hosts the tasks of a whole Cargo workspace, such as documentation, auditing and coverage collection. It is rooted at the workspace folder and depends on every member. When the root manifest also defines a crate, that crate's project takes this role. See [[REQ-WORKSPACE-PROJECT]].
:::

:::mara term TERM-BUILD-DIR
:mid: 01M78FHG7FC78D37XE5W6AAEDD
:title: Build directory
:status: accepted

The directory where Cargo keeps intermediate build files, set by `build.build-dir`. Cargo owns it: its layout is internal to Cargo, and the plugin never names a path inside it. Each build directory has one build lock.
:::

:::mara term TERM-ARTIFACT-DIR
:mid: 01M78FHG7FX7GW7Y4KYF94XF2B
:title: Artifact directory
:status: accepted
:aliases: target directory

The directory where Cargo puts final artifacts such as binaries, set by `build.target-dir`. It is the only Cargo directory that Nx outputs point into.
:::

:::mara term TERM-GROUP
:mid: 01M78FHG7FKNVJ758TVW9DMDAD
:title: Batch group
:status: accepted
:aliases: group
:aliases: build flavour

The set of tasks that the plugin serves together, with one cargo command for each step of their target: tasks of the same kind in the same Cargo workspace whose commands would differ only in the crates they select. They have the same feature set, profile and target triple, the same options that shape the command, such as the switch for `--all-targets`, and the same environment.
:::

:::mara term TERM-FEATURE-UNIFICATION
:mid: 01M78FHG7FH1JD1FSYB97BFN9P
:title: Feature unification
:status: accepted

Cargo's merging of the features requested for a shared dependency across all the crates that are built together. The same crate can therefore be compiled with different features of its dependencies depending on which other crates are in the same cargo invocation.
:::

:::mara term TERM-HACK-CRATE
:mid: 01M78FHG7FTG4JJ6EH5BFWDMBF
:title: Hack crate
:status: accepted
:aliases: workspace-hack crate

The crate that cargo-hakari generates and every workspace member depends on. It depends on the workspace's third-party dependencies with the union of the features that the members ask for, so those dependencies are compiled with the same features whichever members are built. It leaves out the members themselves, third-party crates that depend on a member through normal or build dependencies, and platform-specific dependencies on platforms that its configuration does not list ([[EVD-HAKARI-UNIFICATION]]).
:::

:::mara term TERM-EXTERNAL-NODE
:mid: 01M78FHG7FTX12MCSFNZK69KW7
:title: External node
:status: retired

A node in the Nx graph for a dependency that is not a project in the repository. The plugin was to create one per direct external crate dependency, with the prefix `cargo:`.

Retired on 13 November 2026: v1 creates no external nodes. A crate's locked dependencies reach its cache key through the lockfile task of its workspace ([[ADR-LOCKFILE-TASK]], [[DES-LOCKFILE-HASHING]]).
:::

:::mara term TERM-TEST-MODE
:mid: 01M78FHG7FZA0TQ1TJABZBVGAP
:title: Test mode
:status: accepted

The kind of result a `test` task produces in the current run: `full` for the whole suite, or `affected:<baseline commit>` for the tests selected against a coverage baseline. The test mode is part of the task's cache key.
:::

:::mara term TERM-BASELINE
:mid: 01M78FHG7FY74HS6V7R78Z5FYH
:title: Coverage baseline
:status: accepted
:aliases: coverage database

The per-test coverage data that cargo-affected collected for one commit of the main branch. Selecting affected tests means comparing a change against this data.
:::

:::mara term TERM-ARTIFACT-TARGET
:mid: 01M78FHG7F5DC68V07AK3ENTZN
:title: Artifact target
:status: accepted

A target that produces a kind of artifact other than native binaries and libraries, and therefore has its own name: `napi-build` for a Node addon and `wasm-build` for a wasm package.
:::
