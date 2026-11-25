# What nx-rust is

`@convesoft/nx-rust` is an Nx plugin that makes Cargo workspaces first-class Nx
projects while Cargo stays the build tool.

> **Status:** milestones 0.1 to 0.5 are implemented on `main`, and 1.0 release
> candidates are published on npm under the `next` dist-tag
> (`nx add @convesoft/nx-rust@next`). What is left of v1 is real-repository
> validation, as the [roadmap](#roadmap) shows.

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

| Principle                                    | What it means                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cargo is the source of truth                 | Projects, targets and dependencies come from `cargo metadata`.                                      |
| Nx decides what runs and what is cached      | Cargo builds, in as few invocations as possible.                                                    |
| Cargo owns its build directory               | Nx caches task results and final artifacts only.                                                    |
| Cargo behaves as it would without the plugin | Same directories, same default flags, no generated files inside crates apart from artifact outputs. |
| Overrides live in `Cargo.toml`               | `[package.metadata.nx]` per crate, `[workspace.metadata.nx]` for workspace defaults.                |
| Cache correctness over cache ambition        | Running more than a cache key promises is fine. Running less is not.                                |
| v1 targets a single machine                  | Rust tasks are not spread across CI agents.                                                         |

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
published is decided at 1.0 ([ADR-PUBLISHING-AT-1-0](decisions.mara.md#01M7D7W01MEC0ER974G0K2G8M1)).

| Milestone | Status | Contents                                                                                                |
| --------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 0.1       | Done   | Project graph, inferred targets and caching, with one cargo call per task. `init` and crate generators. |
| 0.2       | Done   | Batching and feature unification.                                                                       |
| 0.3       | Done   | nextest, affected tests and the coverage baseline.                                                      |
| 0.4       | Done   | napi and wasm artifacts.                                                                                |
| 0.5       | Done   | Releasing with Nx release.                                                                              |
| 1.0       | Open   | The open assumptions listed under [risks](decisions.mara.md#risks) are checked and closed.              |

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

The reasons are recorded in [ADR-V1-SCOPE](decisions.mara.md#01M78FHG7FTPVXE53KP8PW9NR7) and [ADR-SINGLE-MACHINE](decisions.mara.md#01M78FHG7FYYRPH4D9BRH2Y94M). Adding
one of these needs a recorded need and decision before it is built.

## Goals

---

<a id="01M78FHG7FRG7B5PSZD2NZ1ZAZ"></a>

### Keep Cargo the build tool and the source of truth

| Type   | Goal              |
| ------ | ----------------- |
| ID     | GOAL-CARGO-NATIVE |
| Status | Accepted          |

Rust developers in an Nx monorepo keep working exactly as they would without the plugin. Cargo builds, the Cargo manifests describe the crates, and plain `cargo` and rust-analyzer behave the same with the plugin installed. Nothing about a crate has to be stated a second time for Nx, so the two descriptions cannot drift apart.

---

<a id="01M78FHG7F29A0KR2HCWPTFFZ1"></a>

### Treat Rust and JS as one monorepo

| Type   | Goal              |
| ------ | ----------------- |
| ID     | GOAL-ONE-MONOREPO |
| Status | Accepted          |

In a repository that mixes JS/TS and Rust, one Nx graph, one cache, one `nx affected` and one set of commands cover both languages. A change in a Rust crate reaches the JS projects that consume it, and the other way round, without glue scripts.

---

<a id="01M78FHG7F44E8BAFK3ZZJRQT7"></a>

### Never restore a wrong result

| Type   | Goal               |
| ------ | ------------------ |
| ID     | GOAL-TRUSTED-CACHE |
| Status | Accepted           |

A result restored from the Nx cache is the result the task would produce if it ran now. Teams can leave caching on in CI and on developer machines without re-running tasks to be safe. Where the plugin cannot be sure, it runs more work instead of restoring.

---

<a id="01M78FHG7FME1CA6KC45BJAH4E"></a>

### Do as little Rust work as correctness allows

| Type   | Goal               |
| ------ | ------------------ |
| ID     | GOAL-FAST-FEEDBACK |
| Status | Accepted           |

A change triggers only the compilation and tests that it can affect, and that work costs about what a well-tuned plain cargo setup would cost. Developers and CI get Rust feedback in time proportional to the change, not to the size of the repository.

---

## Needs

---

<a id="01M78FHG7F6ZMMNWYB6PVC4PPT"></a>

### Use a Cargo workspace without describing it again

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-ZERO-CONFIG                                 |
| Status         | Accepted                                         |
| Contributes to | [GOAL-CARGO-NATIVE](#01M78FHG7FRG7B5PSZD2NZ1ZAZ) |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

A team can add the plugin to a repository and get Nx projects, targets and dependencies for its crates from the Cargo manifests it already has, without writing or generating per-crate Nx configuration.

---

<a id="01M78FHG7F1CQQA7RNG78E8109"></a>

### Keep the repository layout the team already has

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-ANY-LAYOUT                                  |
| Status         | Accepted                                         |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

The plugin works with the Cargo layout a repository already has: one workspace or several, at the Nx root or in subfolders, standalone crates, crates excluded from a workspace, path dependencies between workspaces, and vendored or generated crates that should be left alone.

---

<a id="01M78FHG7FQRS21JJJXM330EJE"></a>

### Keep plain cargo and editor tooling working unchanged

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-CARGO-UNCHANGED                             |
| Status         | Accepted                                         |
| Contributes to | [GOAL-CARGO-NATIVE](#01M78FHG7FRG7B5PSZD2NZ1ZAZ) |

A developer can run `cargo` directly and use rust-analyzer in a repository that has the plugin, and get the behaviour, directories and build reuse they would have without it. Work done through Nx and work done through plain cargo do not invalidate each other.

---

<a id="01M78FHG7FKY2H96D624M0CEMJ"></a>

### Adjust the plugin where the crate is described

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-CONFIG-IN-CARGO                             |
| Status         | Accepted                                         |
| Contributes to | [GOAL-CARGO-NATIVE](#01M78FHG7FRG7B5PSZD2NZ1ZAZ) |

When a crate or workspace needs something other than the default, such as tags, another project name or different options for a target, a developer states it in the Cargo manifest that already describes that crate or workspace.

---

<a id="01M78FHG7F03FJS926C86QPTPP"></a>

### Run Rust and JS tasks with the same commands

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-UNIFORM-COMMANDS                            |
| Status         | Accepted                                         |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

The commands a mixed repository already uses for JS projects, such as `nx affected -t lint test build`, also cover its Rust crates, so developers and CI pipelines do not need a second set of commands for Rust.

---

<a id="01M78FHG7FMWW59PS4KPRKVCEJ"></a>

### Trust cached results

| Type           | Need                                              |
| -------------- | ------------------------------------------------- |
| ID             | NEED-CORRECT-CACHE                                |
| Status         | Accepted                                          |
| Contributes to | [GOAL-TRUSTED-CACHE](#01M78FHG7F44E8BAFK3ZZJRQT7) |

Developers and CI can rely on a cache hit for a Rust task: everything that can change the task's result is part of what decides whether the cached result is reused, and a result of one kind is never reused as a result of another kind.

---

<a id="01M78FHG7F4CKFXTSBXJ7131EY"></a>

### Run only what a change affects

| Type           | Need                                              |
| -------------- | ------------------------------------------------- |
| ID             | NEED-AFFECTED                                     |
| Status         | Accepted                                          |
| Contributes to | [GOAL-FAST-FEEDBACK](#01M78FHG7FME1CA6KC45BJAH4E) |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1)  |

Given a change, developers and CI can run the tasks of the crates and JS projects it can affect, and skip the rest, across language boundaries. A change in a dependency, including one used only by tests or build scripts, counts as affecting its dependents.

---

<a id="01M78FHG7F597HWJZPETAMWPQ4"></a>

### Avoid repeated and contended compilation

| Type           | Need                                              |
| -------------- | ------------------------------------------------- |
| ID             | NEED-EFFICIENT-BUILDS                             |
| Status         | Accepted                                          |
| Contributes to | [GOAL-FAST-FEEDBACK](#01M78FHG7FME1CA6KC45BJAH4E) |

Running many Rust tasks through Nx does not compile the same code several times with the same features, does not queue cargo processes behind one build lock, and does not rebuild because a different set of crates happened to run together.

---

<a id="01M78FHG7FX5BYGF6N2SGWAV2D"></a>

### Get test feedback proportional to the change

| Type           | Need                                              |
| -------------- | ------------------------------------------------- |
| ID             | NEED-FAST-TESTS                                   |
| Status         | Accepted                                          |
| Contributes to | [GOAL-FAST-FEEDBACK](#01M78FHG7FME1CA6KC45BJAH4E) |

A developer who changes a few lines in a large crate can get the results of the tests that the change can affect without waiting for the crate's whole suite, while the full suite still runs for every state of the main branch.

---

<a id="01M78FHG7F1RBZVPETF1K490S9"></a>

### Consume Rust from JS projects

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-JS-BRIDGE                                   |
| Status         | Accepted                                         |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

A JS project can depend on a Rust crate that is built into a Node addon or a wasm package. Building the JS project builds the artifact first when needed, and a change in the crate affects the JS project.

---

<a id="01M78FHG7F4QQYZSG4XA0NKA2W"></a>

### Version and publish crates with the rest of the repository

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-RELEASE                                     |
| Status         | Accepted                                         |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

A team that releases its JS packages with Nx release can version and publish its crates through the same process, with versions of dependent crates and the lockfile kept consistent.

---

<a id="01M78FHG7F7N61AHPME24567FE"></a>

### Start using the plugin without trial and error

| Type           | Need                                             |
| -------------- | ------------------------------------------------ |
| ID             | NEED-EASY-SETUP                                  |
| Status         | Accepted                                         |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1) |

A team can add the plugin to an existing repository, and add new crates later, with one command each, and can tell from the documentation whether its Nx, Cargo and operating system are supported.

---

<a id="01M78FHG7FV4WYX1Q7P92VTFTT"></a>

### Understand what is missing or misconfigured

| Type           | Need                                              |
| -------------- | ------------------------------------------------- |
| ID             | NEED-CLEAR-FAILURES                               |
| Status         | Accepted                                          |
| Contributes to | [GOAL-ONE-MONOREPO](#01M78FHG7F29A0KR2HCWPTFFZ1)  |
| Contributes to | [GOAL-TRUSTED-CACHE](#01M78FHG7F44E8BAFK3ZZJRQT7) |

When a tool is missing, a version is unsupported or a setting cannot work, the developer learns what is wrong, where, and what to do about it, before or instead of a confusing failure deep inside a build.

---

## Vocabulary

---

<a id="01M78FHG7FMWPZ9BFDB3SSSXM3"></a>

### Workspace context

| Type   | Term                   |
| ------ | ---------------------- |
| ID     | TERM-WORKSPACE-CONTEXT |
| Status | Accepted               |

Everything that Cargo scopes to one Cargo workspace and that the plugin therefore handles per workspace: the lockfile, the build directory, the toolchain file, the batches and the coverage baseline. A repository has one workspace context per Cargo workspace, including each [TERM-STANDALONE-CRATE](#01M78FHG7F37Z611RA86TV4DP2).

---

<a id="01M78FHG7F37Z611RA86TV4DP2"></a>

### Standalone crate

| Type    | Term                  |
| ------- | --------------------- |
| ID      | TERM-STANDALONE-CRATE |
| Status  | Accepted              |
| Aliases | workspace of one      |

A crate that is not a member of any Cargo workspace, either because no enclosing manifest declares a workspace or because the enclosing workspace excludes it. The plugin treats it as a workspace with one member, with its own lockfile and build directory.

---

<a id="01M78FHG7F8DTF27C4K7XPZK6X"></a>

### Workspace project

| Type    | Term                   |
| ------- | ---------------------- |
| ID      | TERM-WORKSPACE-PROJECT |
| Status  | Accepted               |
| Aliases | synthetic project      |

The Nx project that hosts the tasks of a whole Cargo workspace, such as documentation, auditing and coverage collection. It is rooted at the workspace folder and depends on every member. When the root manifest also defines a crate, that crate's project takes this role. See [REQ-WORKSPACE-PROJECT](workspaces.mara.md#01M78FHG7FEH8W5X747EMPM5B1).

---

<a id="01M78FHG7FC78D37XE5W6AAEDD"></a>

### Build directory

| Type   | Term           |
| ------ | -------------- |
| ID     | TERM-BUILD-DIR |
| Status | Accepted       |

The directory where Cargo keeps intermediate build files, set by `build.build-dir`. Cargo owns it: its layout is internal to Cargo, and the plugin never names a path inside it. Each build directory has one build lock.

---

<a id="01M78FHG7FX7GW7Y4KYF94XF2B"></a>

### Artifact directory

| Type    | Term              |
| ------- | ----------------- |
| ID      | TERM-ARTIFACT-DIR |
| Status  | Accepted          |
| Aliases | target directory  |

The directory where Cargo puts final artifacts such as binaries, set by `build.target-dir`. It is the only Cargo directory that Nx outputs point into.

---

<a id="01M78FHG7FKNVJ758TVW9DMDAD"></a>

### Batch group

| Type    | Term          |
| ------- | ------------- |
| ID      | TERM-GROUP    |
| Status  | Accepted      |
| Aliases | group         |
| Aliases | build flavour |

The set of tasks that the plugin serves together, with one cargo command for each step of their target: tasks of the same kind in the same Cargo workspace whose commands would differ only in the crates they select. They have the same feature set, profile and target triple, the same options that shape the command, such as the switch for `--all-targets`, and the same environment, of which cargo never gets the two variables by which Nx names a task's project ([ADR-TASK-NAME-VARIABLES](decisions.mara.md#01M7FZHXES8CVY46H25QJG3BV7)), so that tasks of one target and configuration share it. Where their command would pass a flag whose effect on a crate depends on which other crates it selects, would select crates whose features cargo then resolves for that selection alone, or would set a runner where the user may have configured one, each task forms a group of one crate ([DES-BATCH](execution.mara.md#01M78FHG7FY1VKFFHZ8G4WFDBJ)). Only those cases do: a group that holds one task because the command names one crate, or because Nx restored the others from the cache, selects its crates as any group does.

---

<a id="01M78FHG7FH1JD1FSYB97BFN9P"></a>

### Feature unification

| Type   | Term                     |
| ------ | ------------------------ |
| ID     | TERM-FEATURE-UNIFICATION |
| Status | Accepted                 |

Cargo's merging of the features requested for a shared dependency across all the crates that are built together. The same crate can therefore be compiled with different features of its dependencies depending on which other crates are in the same cargo invocation.

---

<a id="01M78FHG7FTG4JJ6EH5BFWDMBF"></a>

### Hack crate

| Type    | Term                 |
| ------- | -------------------- |
| ID      | TERM-HACK-CRATE      |
| Status  | Accepted             |
| Aliases | workspace-hack crate |

The crate that cargo-hakari generates and every workspace member depends on. It depends on the workspace's third-party dependencies with the union of the features that the members ask for, so those dependencies are compiled with the same features whichever members are built. It leaves out the members themselves, third-party crates that depend on a member through normal or build dependencies, and platform-specific dependencies on platforms that its configuration does not list ([EVD-HAKARI-UNIFICATION](decisions.mara.md#01M7D9EQW8FQW9BAEZSHQ37116)). The workspace's cargo-hakari configuration names it. The plugin never publishes it, and [DES-RELEASE](release.mara.md#01M78FHG7F65ZV4NB8NPNJGH1T) says what happens to the crates that depend on it when they are published.

---

<a id="01M78FHG7FTX12MCSFNZK69KW7"></a>

### External node

| Type   | Term               |
| ------ | ------------------ |
| ID     | TERM-EXTERNAL-NODE |
| Status | Retired            |

A node in the Nx graph for a dependency that is not a project in the repository. The plugin was to create one per direct external crate dependency, with the prefix `cargo:`.

Retired on 13 November 2026: v1 creates no external nodes. A crate's locked dependencies reach its cache key through the lockfile task of its workspace ([ADR-LOCKFILE-TASK](decisions.mara.md#01M7ACCPE3JYNPZCK42RZG5H3H), [DES-LOCKFILE-HASHING](workspaces.mara.md#01M78FHG7FQWJY49AGS0FVGY2D)).

---

<a id="01M78FHG7FZA0TQ1TJABZBVGAP"></a>

### Test mode

| Type   | Term           |
| ------ | -------------- |
| ID     | TERM-TEST-MODE |
| Status | Accepted       |

The kind of result a `test` task produces in the current run: `full` for the whole suite, or `affected:<baseline commit>` for the tests selected against a coverage baseline. The test mode is part of the task's cache key.

---

<a id="01M78FHG7FY74HS6V7R78Z5FYH"></a>

### Coverage baseline

| Type    | Term              |
| ------- | ----------------- |
| ID      | TERM-BASELINE     |
| Status  | Accepted          |
| Aliases | coverage database |

The per-test coverage data that cargo-affected collected for one commit of the main branch. Selecting affected tests means comparing a change against this data.

---

<a id="01M78FHG7F5DC68V07AK3ENTZN"></a>

### Artifact target

| Type   | Term                 |
| ------ | -------------------- |
| ID     | TERM-ARTIFACT-TARGET |
| Status | Accepted             |

A target that produces a kind of artifact other than native binaries and libraries, and therefore has its own name: `napi-build` for a Node addon and `wasm-build` for a wasm package.
