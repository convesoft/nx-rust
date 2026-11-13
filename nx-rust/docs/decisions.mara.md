# Decisions and risks

The choices behind nx-rust, the risks it carries, and the evidence the choices
rest on. Most of this comes from a design discussion recorded on 12 November 2026.

## Decisions

:::mara decision ADR-NEW-PLUGIN
:mid: 01M78FHG7FZFXQ6B84EG2CKHRS
:title: Build a new plugin that closes the gaps of the existing ones
:status: accepted
:justifies: REQ-DEPENDENCY-EDGES
:justifies: REQ-EXTERNAL-DEPS
:justifies: REQ-MULTI-WORKSPACE
:justifies: REQ-BATCHING

Three projects were read before this design. [eddacraft/nxrust](https://github.com/eddacraft/nxrust) (v0.3.0) is the closest prior art and already reads overrides from Cargo metadata. [@monodon/rust](https://github.com/Cammisuli/monodon) (3.0.0, requires Nx 22) is the plugin the Nx documentation lists, and the reference for Nx release on `Cargo.toml`. [max-sixty/cargo-affected](https://github.com/max-sixty/cargo-affected) (0.4.1, self-described as very early) selects tests by coverage on top of nextest.

None of them is a dependency of this design, except cargo-affected, which is optional. nx-rust is a separate plugin whose design starts from the gaps found in nxrust ([[EVD-NXRUST-GAPS]]): dev-dependencies missing from the graph, the whole lockfile as an input, no batching and no handling of feature unification, unhashed build-script and Cargo configuration inputs, an in-memory metadata cache with the workspace fixed at the Nx root, and builds that restore `rlib` files into Cargo's directory.
:::

:::mara decision ADR-CARGO-SOURCE-OF-TRUTH
:mid: 01M78FHG7F2CB9W8YBQ9DNXCB0
:title: Take projects, targets and dependencies from cargo metadata
:status: accepted
:justifies: REQ-INFERRED-PROJECTS
:justifies: DES-METADATA-REPORT
:justifies: DES-DISCOVERY

A second description of a crate, such as a `project.json`, has to be written, kept in step with `Cargo.toml` and reviewed, and it drifts. Cargo already knows the members, their targets and their dependencies, and reports them through `cargo metadata`. The plugin takes everything from that report and needs no per-crate Nx file. The cost is one cargo call per workspace when the graph is created, and a design that is limited to what Cargo reports plus the metadata tables.

It also means that every machine that computes the graph needs cargo, including one that only runs JS tasks. When cargo is missing or rejects a manifest, graph creation fails. Leaving the Rust projects out instead was rejected: that machine would have another graph and other cache keys than the rest of the team, and `nx affected` would skip crates without saying so.
:::

:::mara decision ADR-METADATA-NO-DEPS
:mid: 01M78RC7T7GK1RSH8S11ZV38EZ
:title: Build the graph from cargo metadata without dependency resolution
:status: accepted
:justifies: DES-METADATA-REPORT

`cargo metadata` can resolve the whole dependency graph or, with `--no-deps`, report only the workspace's own packages. The full report was the first assumption. It needs the manifest of every dependency, so on a machine without a filled Cargo cache it downloads the crates of the lockfile, and it creates or updates `Cargo.lock` on the way. Nx builds the project graph for every command, also for JS-only work and in every CI job, and each of those machines needs cargo ([[ADR-CARGO-SOURCE-OF-TRUTH]]). The full report would add a registry download to all of them.

The plugin therefore asks with `--no-deps`. That report still names the members, their targets, their declared dependencies with paths and features, the metadata tables and Cargo's directories, which is all that projects, targets and edges need, apart from the crates that `[patch]`, `[replace]` and `paths` redirect to ([[EVD-CARGO-NO-DEPS]]). What it lacks is the resolved versions of external crates. Only per-crate lockfile hashing needs those, and `Cargo.lock` holds them. The cost is that the plugin reads `Cargo.lock` itself for that purpose, that a path dependency outside the workspace needs a report of its own, and that the plugin reads the redirection tables from Cargo's manifests and configuration files itself ([[ADR-REDIRECTION-EDGES]]).
:::

:::mara decision ADR-MULTI-WORKSPACE
:mid: 01M78FHG7FZZT4VV8SYT01Z2B2
:title: Support several Cargo workspaces through a workspace context
:status: accepted
:justifies: REQ-MULTI-WORKSPACE
:justifies: DES-DISCOVERY

Repositories that add Rust to an existing monorepo rarely have one Cargo workspace at the Nx root: they have a workspace in a subfolder, tools as standalone crates, and sometimes several workspaces. Requiring one root workspace would force a restructuring before the plugin can be tried. The plugin supports any number of workspaces anywhere, and hangs everything Cargo scopes to a workspace off one [[TERM-WORKSPACE-CONTEXT]]: lockfile, build directory, toolchain file, batch and coverage database. Standalone crates are workspaces of one and share no build directory; the plugin does not hide that.
:::

:::mara decision ADR-PROJECT-NAMES
:mid: 01M78FHG7FAG0YENBEH7FQ7WX1
:title: Name projects after crates and fail on a collision
:status: accepted
:justifies: REQ-PROJECT-NAMES

The crate name is what a Rust developer types, so it is the Nx project name. With several workspaces two crates can share a name. Deriving unique names automatically, for example from paths, would make names unpredictable and would change them when a second crate appears. A collision is therefore an error naming both paths, and the user fixes it with a per-crate name or a per-workspace prefix in metadata. Because commands always use the real package name and manifest path, the Nx name is free to differ. A crate whose folder also is a JS project is the exception. Nx applies `package.json` and `project.json` after every plugin, so the name set there wins, and neither the crate name nor its `name` override can change it ([[EVD-NX-PROJECT-MERGE]]).
:::

:::mara decision ADR-WORKSPACE-PROJECT-NAME
:mid: 01M7A8AKF5KKZ457ED2PX0NX4D
:title: Name the workspace project after its folder's path
:status: accepted
:justifies: REQ-PROJECT-NAMES
:justifies: REQ-METADATA-OVERRIDES
:justifies: DES-PROJECT-GRAPH
:justifies: DES-METADATA-TABLES

Agreed with the maintainer on 13 November 2026, for a [[TERM-WORKSPACE-PROJECT]] whose root manifest defines no crate. Cargo has no name for a workspace ([[EVD-WORKSPACE-PROJECT-NAMES]]), so the plugin derives one: the path of the workspace folder from the root of the Nx workspace, with each `/` replaced by `-`. Such a name is determined by the workspace's folder alone: it needs no configuration and does not depend on which other workspaces or crates exist, so it does not change when one appears, and the objection of [[ADR-PROJECT-NAMES]] to names derived from paths does not apply. Nx also accepts the folder itself where a project name is expected. The root of the Nx workspace has no such path, and its folder name differs between checkouts, so a workspace there is called `cargo-workspace`. Rejected: the folder's last segment, which is Nx's own default for a `project.json` without a name but lets `a/rust` and `b/rust` collide; the path with a `-workspace` suffix, which collides less often but is longer; one fixed name, which every workspace after the first would have to override; `rust` at the root, which a workspace in `rust/` gets too; and the name in the root `package.json`, which would name a Cargo project from a JS file. The names are not unique. `services/billing/` and `services-billing/` both give `services-billing`, the root and a folder `cargo-workspace/` both give `cargo-workspace`, and a folder named like one of its own crates gives that crate's name. Each of these fails like any other collision between two projects of this plugin, and the `name` in `[workspace.metadata.nx.project]` resolves it.

A collision between any two of the plugin's projects, crates or workspace projects, fails with the plugin's error, so that the user learns both manifests and both remedies; one with a JS project stays Nx's error, as for crates. The override is the sub-table `[workspace.metadata.nx.project]`, holding the `name`, `tags` and `targets` of a package table, because [[ADR-METADATA-KEY]] makes the `nx` table hold what a `project.json` holds while the workspace table's own keys are defaults for the members. Rejected: `workspaceProject`, which is long; `root`, which Nx uses for a project's folder; and a flat `name` in the workspace table, which reads as a default for members and leaves the project's own targets without a place. When the root manifest defines a crate, that crate's table already configures the project, so the sub-table is an error instead of a second place for the same settings. The workspace's name prefix stays with the members, whose names it separates; a workspace project's default name comes from its folder, and a collision of that name is resolved with the project's own `name`. Names are neither checked nor rewritten beyond `/` to `-`: Nx accepts any string, and the characters that are awkward on its command line are rare in folder names and fixed with the override. Where the workspace folder already is an Nx project, Nx merges the two and names the result ([[EVD-NX-PROJECT-MERGE]]); the plugin accepts that as it does for a crate, because [[REQ-WORKSPACE-PROJECT]] fixes the project's root.
:::

:::mara decision ADR-ALL-DEP-KINDS
:mid: 01M78FHG7F89HNQ2GAMHTHFRC2
:title: Keep every dependency kind in the graph, including cycles
:status: accepted
:justifies: REQ-DEPENDENCY-EDGES
:justifies: DES-PROJECT-GRAPH

Leaving dev-dependencies out of the graph means a change in a crate used only by another crate's tests does not invalidate those cached tests. All three kinds are therefore edges.

Cargo allows cycles through dev-dependencies. Three treatments were considered: drop the edge that closes the cycle and add the crate's files as explicit inputs, fail graph creation, or keep the edge. Nx 24 fails only on a cycle between tasks, not between projects ([[EVD-NX-24-INSPECTION]]), and the plugin's targets declare no dependencies between crates beyond the lockfile task, which depends on nothing ([[ADR-NO-RUST-BUILD-DEPS]]). The edge is kept, so `nx graph` shows at least what Cargo sees and no workspace that Cargo accepts is rejected. The exception is an edge to a crate that `[patch]`, `[replace]` or `paths` redirects to and that reaches the edge's source through normal or build dependencies: Cargo rejects that cycle, so the edge is left out and inputs cover the source's dev-dependencies ([[ADR-REDIRECTION-EDGES]]). If a user's own `dependsOn` turns the project cycle into a task cycle, Nx reports it. Nx 24 hashes `^` inputs over a project cycle stably ([[EVD-NX-24-INPUT-SEMANTICS]]).
:::

:::mara decision ADR-EXTERNAL-NODES
:mid: 01M78FHG7FYRBX038BA9MX7YXN
:title: Represent external crates as graph nodes
:status: retired

With the whole `Cargo.lock` as an input, any dependency update invalidates every crate of the workspace. Each direct external dependency becomes a node with the prefix `cargo:` instead, so a crate can be hashed on the dependencies it uses. This is agreed in principle; the hashing mechanism is not designed yet.

Neither is the identity of a node. Several workspaces have several lockfiles, and one lockfile can hold several versions of a crate, so a name without a version cannot stand for all of them. The nodes are therefore created only together with the hashing design, and until then the whole lockfile stays an input.

Retired on 13 November 2026: v1 creates no external nodes. Nx 24 keys crates correctly through such nodes, but `nx affected` ignores them after a change to `Cargo.lock` alone ([[EVD-NX-24-EXTERNAL-NODES]]). [[ADR-LOCKFILE-TASK]] replaces this decision.
:::

:::mara decision ADR-LOCKFILE-TASK
:mid: 01M7ACCPE3JYNPZCK42RZG5H3H
:title: Key crates on a lockfile task per workspace, not on external nodes
:status: accepted
:justifies: REQ-EXTERNAL-DEPS
:justifies: DES-LOCKFILE-HASHING
:justifies: REQ-NO-RUST-TASK-DEPS
:supersedes: ADR-EXTERNAL-NODES

With the whole `Cargo.lock` as an input, any dependency update invalidates every crate of the workspace. [[ADR-EXTERNAL-NODES]] planned a graph node with the prefix `cargo:` for each external dependency, so that a crate's key could follow the dependencies it uses. In Nx 24.0.6 such nodes key the crates correctly, but `nx affected` then selects no crate after a change to `Cargo.lock` alone: Nx works out which external nodes moved only for JS lockfiles, and a plugin has no way to tell it ([[EVD-NX-24-EXTERNAL-NODES]]). A pipeline that runs `nx affected` would skip Rust on every dependency update. The nodes would also reach JS projects: a target without an `externalDependencies` input hashes every external node of the graph, so each change to a `Cargo.lock` would invalidate the `package.json` scripts of every JS project.

Each workspace therefore has one task that reads its `Cargo.lock` and writes, for each crate, a digest of the packages the crate reaches. Every cached target of a crate depends on that task and hashes the crate's digest. A change to `Cargo.lock` reaches the task through its file input, and Nx selects every task that reads the task's output, so `nx affected` selects the crates of that workspace, and those whose digest did not change are restored from the cache ([[EVD-NX-24-LOCKFILE-TASK]]). `nx affected` selects more than it must and the keys select exactly, which is the trade [[GOAL-TRUSTED-CACHE]] asks for.

A digest describes what cargo builds only while cargo calls the lockfile current. A stale lockfile cannot be keyed by its files at all: on identical files, cargo resolved a new dependency to another version once a newer one was published ([[EVD-CARGO-LOCK-CHECK]]). The task therefore first runs `cargo update --workspace`. That leaves a current lockfile alone and brings a stale or missing one up to date exactly as the crates' own cargo commands would, so adding a dependency and running `nx build` works as with plain cargo; in locked mode it fails instead. The task is not cached, because cargo's verdict also depends on files outside the repository, which Nx cannot hash, and Nx 24 keeps a result out of the cache only when the task fails ([[EVD-NX-24-LOCKFILE-UPDATE]]).

Rejected: external nodes alone, for the reasons above; external nodes for the keys together with a task of constant output for `nx affected`, which works but keeps the invalidation of JS projects and needs node names that tell apart versions and lockfiles; a digest in a target option, which keys correctly but which `nx affected` never selects; the whole lockfile, which does not meet [[REQ-EXTERNAL-DEPS]]; a comparison of manifests with lockfile entries written by the plugin, which missed cases that cargo catches; failing the task on a stale lockfile, which breaks adding a dependency and building; and running the crates of a stale workspace uncached under keys that never repeat, which runs them twice and fills the cache with entries nothing reaches.

The costs are one cargo call per workspace in every run that includes a cached crate task, also when every crate is then restored from the cache, and index fetches on a cold cargo home; a rewrite of `Cargo.lock` in a run where every crate task is then restored, which is cargo's own write ([[REQ-NO-MANIFEST-WRITES]]); a dependency of crate targets on a target of another project, the one exception [[REQ-NO-RUST-TASK-DEPS]] makes; a graph that shows no external crates; and reliance on how Nx 24 selects the tasks that read a producer's output, which a later Nx major could change. The end-to-end checks of [[VER-CACHE-KEYS]] cover that selection, and a later major is supported only once they pass ([[ADR-COMPATIBILITY]]).
:::

:::mara decision ADR-METADATA-KEY
:mid: 01M78FHG7FQK38H3AQ3ZN130A0
:title: Keep overrides under the nx key of Cargo metadata
:status: accepted
:justifies: REQ-METADATA-OVERRIDES
:justifies: DES-METADATA-TABLES
:accepts: RISK-METADATA-KEY-COLLISION

Overrides live in `Cargo.toml`, next to what they override, in `[package.metadata.nx]` and `[workspace.metadata.nx]`. The key `nx` mirrors the `nx` property that Nx reads from `package.json` and holds what a `project.json` would hold, which is short and familiar to Nx users. The alternatives were `nx-rust`, named after the package as Cargo tools usually do, and a split between `nx` for project settings and `nx-rust` for plugin switches. `nx` was chosen with the known cost that another Nx plugin for Rust could claim the same key.
:::

:::mara decision ADR-NX-TARGET-NAMES
:mid: 01M78FHG7FTBB2RVZTTTWPYG1P
:title: Use Nx target names by default
:status: accepted
:justifies: REQ-TARGET-NAMES
:justifies: DES-TARGETS
:accepts: RISK-TARGET-DEFAULTS

The plugin is written first for mixed JS/TS and Rust repositories, whose pipelines run `nx affected -t lint test build`. With Cargo's names, clippy would be skipped until every pipeline adds `clippy`. Inferred targets therefore use the Nx name where Nx projects conventionally have a target for the same job: clippy runs as `lint`, and `test` and `build` keep their names. Every name can be changed in the plugin options, so Cargo's names are an opt-in. The cost is that target defaults written for JS targets of the same name also reach Rust targets.

Formatting was decided separately. Nx has a convention for it, but it is the built-in commands `nx format:check` and `nx format:write`, not a target. They run prettier or oxfmt over files and cannot be made to run rustfmt in Nx 24 ([[EVD-NX-FORMAT]]). Naming the rustfmt targets `format-check` with `format-write` or `format` was considered. They keep Cargo's names, `fmt-check` and `fmt`, so that nobody takes them for that command: `format` is a reserved command name, and `nx format <project>` would silently run Nx's formatter instead of `cargo fmt`.

`check` has a counterpart: `typecheck`, which the TypeScript plugin of `@nx/js` infers and which the CI workflow that Nx generates runs beside `lint`, `test` and `build` ([[EVD-NX-24-TARGETS]]). It keeps Cargo's name all the same. That pipeline already runs `lint`, and clippy checks everything `cargo check` does, so a Rust `typecheck` would only check every affected crate a second time; clippy does not reuse what `cargo check` compiled for the crate itself ([[EVD-CARGO-TARGET-COMMANDS]]). A repository that wants the name can rename the target. The remaining targets (`doc`, `bench`, `run`) and the targets of the workspace project (`audit`, `deny`, `update`) have no Nx counterpart and keep the names of Cargo and the tools.
:::

:::mara decision ADR-NO-RUST-BUILD-DEPS
:mid: 01M78FHG7FCE6NXVG4J9K82XME
:title: Put no build dependencies between Rust crates
:status: accepted
:justifies: REQ-NO-RUST-TASK-DEPS
:justifies: DES-TARGETS

Cargo builds a crate's dependencies itself, so a `dependsOn: ["^build"]` between crates adds no ordering that is needed. It only starts one cargo process per dependency, and they queue on the build lock ([[EVD-NXRUST-BUILD-DEPS]]). Invalidation is handled by `^` inputs. JS consumers of an artifact depend on the artifact target.

The first design also made `^build` on edges from JS projects to Rust crates an opt-in. Nx leaves no room for that: a JS target that declares `^build` gets the `build` task of every project it depends on that has such a target, and neither the plugin nor the dependency can decline ([[EVD-NX-24-INSPECTION]]). The plugin therefore adds no dependency to JS projects and removes none. A JS target's own `^build` runs the native `build` of the crates its project depends on directly and stops there, because those targets depend only on their workspace's lockfile task ([[DES-LOCKFILE-HASHING]]), which has no `build`. The cost is a native build that a consumer of a wasm package or a Node addon does not need; batching folds such builds into one cargo call ([[DES-BATCH]]). Renaming the native build so that `^build` would miss it was rejected, because `nx affected -t build` would then skip Rust ([[ADR-NX-TARGET-NAMES]]).
:::

:::mara decision ADR-RESULTS-ONLY-CACHE
:mid: 01M78FHG7FYVQP1W5GZC509GEF
:title: Cache task results and final artifacts, never Cargo's intermediates
:status: accepted
:justifies: REQ-CACHE-OUTPUTS
:justifies: DES-OUTPUTS
:justifies: DES-BUILD-DIRS

Cargo's build directory is large, its layout is internal and changes between Cargo versions, and restoring parts of it from another run confuses Cargo's own freshness checks. Nx therefore stores what a consumer needs: the result of a check or test, and the final artifacts of a build. Cargo keeps its build directory, which CI caches as a whole. A cache hit on `build` gives back a binary, not a warm compiler state; the next real compile relies on the build directory.

Final artifacts are the files that something other than Cargo consumes: executables, and `cdylib` and `staticlib` libraries. An `rlib` or `dylib` only feeds further Rust compilation and stays Cargo's. Nx can store only files inside the repository, so where the artifact directory lies outside it, the targets that would store artifacts run uncached. Caching their result without the files would restore a build that has no binary.
:::

:::mara decision ADR-DECLARED-INPUTS
:mid: 01M78FHG7FGX22WZF138Z8K89G
:title: Describe cache keys with declared inputs, not a custom hasher
:status: accepted
:justifies: DES-INPUTS
:justifies: REQ-ENV-ALLOWLIST

Nx deprecates custom hashers and plans to remove them in Nx 25 ([[EVD-NX-24-INSPECTION]]). Task-based affected, the default in Nx 24, selects tasks by matching changed files against their declared inputs, so complete file inputs are also what make `nx affected` correct. Environment and runtime inputs only change keys: a change to them alone makes no task affected ([[EVD-NX-24-INPUT-SEMANTICS]]). All cache inputs are therefore declared: filesets, `^` inputs, environment variables, runtime commands and target options. Environment variables come from a fixed, extendable list, never the whole environment, because a key that includes everything never repeats.

For files the choice goes the other way. The whole folder of a crate is an input, not a list of source folders. A list would invalidate less, but it misses what macros and build scripts read: a README included as crate documentation, templates, migrations, protocol definitions, and sources at a path the manifest names. Running a crate's tasks again after a change that could not affect them is the accepted side of that trade. A negated pattern in the repository's own configuration takes files out of the folder's input, on the repository's responsibility.
:::

:::mara decision ADR-BATCH-EXECUTOR
:mid: 01M78FHG7F9MD0KQ68Y5CC4HK5
:title: Run tasks through an Nx batch executor
:status: accepted
:justifies: REQ-BATCHING
:justifies: DES-BATCH
:accepts: RISK-BATCH-BEHAVIOUR

Nx decides what runs and what is cached, per crate. Cargo should still be invoked as few times as possible, because each invocation takes the build lock and resolves the workspace again. An executor with `batchImplementation` and `preferBatch: true` gets both: Nx hashes, restores and caches each task, and the plugin runs one cargo call per group. The known cost is that Nx starts no other task while a batch runs.
:::

:::mara decision ADR-WORKSPACE-FEATURES
:mid: 01M78FHG7F9M47HN1VS68YT9K3
:title: Always resolve features for the whole workspace
:status: accepted
:justifies: REQ-STABLE-FEATURES
:justifies: DES-UNIFICATION
:justifies: DES-FEATURE-SETS

A batch of whatever is affected changes the set of crates built together on every run. Because of [[TERM-FEATURE-UNIFICATION]], that changes the features of shared dependencies, which causes rebuild churn and makes a crate's result depend on its batch. The plugin therefore resolves features for the whole workspace on every run. Three strategies do this at different costs: `hakari` where the workspace already uses cargo-hakari, Cargo's own `feature-unification` setting as an experimental opt-in, and building the whole workspace as the fallback that always works.
:::

:::mara decision ADR-ONE-TEST-TARGET
:mid: 01M78FHG7FWYPHVZ9TAHHZ0A5N
:title: Keep one test target and put the mode in the cache key
:status: accepted
:justifies: REQ-AFFECTED-TESTS
:justifies: REQ-TEST-MODE-KEY
:justifies: DES-TEST-MODE

Affected-test selection could be a second target beside `test`. Users would then have to know which one to run where, and pipelines would differ between branches. Instead there is one `test` target that decides inside whether to run a subset or the full suite. What keeps the cache honest is the [[TERM-TEST-MODE]] in the key: a runtime input that prints `full` or `affected:<baseline commit>`.
:::

:::mara decision ADR-TEST-MODE-CHOICE
:mid: 01M78NVF8E9Q5SD8FDP09ADE2D
:title: Let the consumer choose the test mode, with a default per environment
:status: accepted
:justifies: DES-TEST-MODE
:justifies: REQ-AFFECTED-TESTS

The first design said the mode is `full` on the main branch and `affected` elsewhere. The plugin cannot tell reliably which of the two it is on: CI checkouts are detached or shallow, pull requests are tested on merge commits, and release branches and merge queues are neither. Asking Git whether HEAD is contained in the default branch was considered and rejected for the same reasons. The pipeline knows what it is running, so the consumer chooses: the environment variable `NX_RUST_TEST_MODE` names the mode of a run.

Two things follow. The `affectedTests` setting does not choose a mode. It declares that a workspace uses selection, which adds the baseline target and the mode input and makes every machine check the setup, so a missing tool shows on a developer's machine and not first in CI. And the default without the variable depends on where the run happens: `affected` on a developer's machine, so that local work gets selection without any setup, and `full` where Nx detects CI ([[EVD-NX-24-INSPECTION]]), so that a pipeline that sets nothing, such as the one for main, runs the whole suite. A pull request pipeline asks for `affected` explicitly.

An environment variable switches selection on, and not a command-line flag, because the command that puts the mode into the cache key can read the environment but not the `nx` command line. The flag `--affectedTests=false` can only force the full suite.
:::

:::mara decision ADR-TEST-SELECTOR
:mid: 01M78FHG7FH90JZ8ESEP4R4HCJ
:title: Use cargo-affected only to select and nextest to run
:status: accepted
:justifies: DES-TEST-RUN
:justifies: REQ-DOCTESTS

cargo-affected can both select and run tests, but it is very early and has no archive support. The plugin asks it for the selection only and runs the tests itself through nextest, which keeps per-crate results under the plugin's control, keeps the selector replaceable, and leaves room for a distributed mode. nextest does not run doctests, so they run through `cargo test --doc` whenever nextest is the runner; that is not optional.
:::

:::mara decision ADR-ARTIFACT-TARGET-NAMES
:mid: 01M78FHG7FYRNEHZNVW6V2DWJ0
:title: Give each kind of artifact its own target name
:status: accepted
:justifies: REQ-ARTIFACT-TARGETS
:justifies: DES-ARTIFACT-STEPS

A different kind of artifact gets its own target name (`napi-build`, `wasm-build`); a different flavour of the same artifact is a flag. One `build` target with a configuration per artifact was rejected for four reasons. Nx's `dependsOn` names a target and cannot pin a configuration of it ([[EVD-NX-24-INSPECTION]]), so a JS app could not depend on the wasm build. `nx run-many -t build -c wasm` would run the default native build on every crate without a wasm configuration. One configuration applies per invocation, so native plus wasm would take two commands. And a named target exists only on crates that produce that artifact.
:::

:::mara decision ADR-NO-WASM-PACK
:mid: 01M78FHG7F6KP7TGK6B0447FHY
:title: Call cargo and the wasm-bindgen CLI directly
:status: accepted
:justifies: DES-WASM

wasm-pack is not a base to build on: the rustwasm organisation was sunset in 2025 and wasm-pack was slated for archiving. The plugin runs `cargo build` and the `wasm-bindgen` CLI itself, which also lets the compile step take part in batching.
:::

:::mara decision ADR-SINGLE-MACHINE
:mid: 01M78FHG7FYYRPH4D9BRH2Y94M
:title: Target a single machine in v1
:status: accepted
:justifies: DES-TEST-PHASES

Spreading Rust tasks across Nx agents needs answers that are not available yet: where Nx computes hashes, whether targets can be pinned to one machine, and how batched tasks are assigned to agents. v1 runs all Rust tasks of a pipeline on one machine. The only v1 requirement for a later distributed mode is a seam: the test executor keeps building and running as separate internal phases.
:::

:::mara decision ADR-COMPATIBILITY
:mid: 01M78FHG7FFBVZPZCQKJNXGT0P
:title: Support Nx 24, Cargo 1.91+, Linux and macOS
:status: accepted
:justifies: REQ-COMPATIBILITY
:justifies: DES-BUILD-DIRS

Nx 24 makes task-based affected the default, which the cache design relies on. The plugin supports the Nx majors its end-to-end suite has passed on, which is Nx 24 at first. The batch executor interface and the way Nx evaluates inputs are not stable across majors ([[RISK-UPSTREAM-CHANGES]]), so a later major joins the package's peer dependency range only once the suite passes on it. Promising "Nx 24 and later" was rejected, because it would claim behaviour nobody has checked. Cargo 1.91 is the first version with a separate build directory, so there is one cache model and no degraded mode for older toolchains. Windows hosts need their own handling of paths, shells and linkers and are left out of v1. A repository with an older Nx or Cargo gets a clear error.
:::

:::mara decision ADR-V1-SCOPE
:mid: 01M78FHG7FTPVXE53KP8PW9NR7
:title: Limit what v1 does
:status: accepted
:justifies: REQ-NO-MANIFEST-WRITES
:justifies: REQ-DIAGNOSTICS
:justifies: REQ-COMPATIBILITY
:accepts: RISK-UNDECLARED-INPUTS
:accepts: RISK-HOST-ENVIRONMENT

The plugin stays a thin layer between Nx and Cargo. It does not install toolchains or tools: rustup, nextest, cargo-affected, cargo-hakari and the `wasm-bindgen` CLI are the user's to install, and the plugin reports what is missing. It does not build hermetically: there is no sandbox and no remote execution, and it trusts Cargo and a declared set of inputs. It does not write `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml` outside generators, release and tasks the user runs to change them. It does not run on Windows hosts.

Also outside v1: cross-compiling Node addons to other platforms, wasm tests, publishing napi and wasm packages to npm, tests on triples other than the host, migration from `@monodon/rust`, formatting Rust through `nx format` ([[EVD-NX-FORMAT]]), and distributed execution ([[ADR-SINGLE-MACHINE]]). Adding any of these needs a recorded need and decision first.
:::

:::mara decision ADR-SETUP-GENERATORS
:mid: 01M78FHG7FYKPH14862MWJ4KJB
:title: Ship init and crate generators in v1
:status: accepted
:justifies: REQ-INIT
:justifies: REQ-CRATE-GENERATORS

v1 has an `init` generator behind `nx add`, and `library` and `binary` generators that wrap `cargo new`. Because projects are inferred, generators are a convenience: a crate created with plain `cargo new` works the same. A generator that migrates a repository from `@monodon/rust` is left for later.
:::

:::mara decision ADR-WORKSPACE-ROOT
:mid: 01M78NVF8ENATA4CGDH3PMYVSF
:title: Run cargo in the workspace root and key the toolchain found there
:status: accepted
:justifies: DES-INVOCATION
:justifies: DES-INPUTS
:justifies: REQ-TOOLCHAIN-KEY

rustup picks the toolchain file, and Cargo its configuration files, from the folder a command starts in and its parents, not from the manifest of the crate being built. A command for a group of crates has one such folder. The plugin therefore starts every cargo command in the workspace root, so the toolchain file and configuration files found from the workspace root apply to every task ([[TERM-WORKSPACE-CONTEXT]]). A task's environment can still override the toolchain file, as `RUSTUP_TOOLCHAIN` in a crate's `.env` does, and the toolchain input is evaluated with that environment ([[EVD-NX-24-INPUT-SEMANTICS]]). Starting each task in its crate's folder was rejected: per-crate files would apply as they do for a developer who works in that folder, but crates with such files could not share an invocation.

The first design keyed the toolchain with `rustup run <channel> rustc -Vv`, with the channel read from the toolchain file. That needs rustup, and it misses a toolchain chosen through `RUSTUP_TOOLCHAIN` or `rustup override`, which cargo honours. Plain `rustc -Vv`, run in the workspace root, asks the question cargo will ask, with or without rustup.

The cost is that a toolchain or configuration file inside a member crate changes the cache key without changing what Nx runs, and that a developer who starts cargo inside such a crate builds differently from Nx. The documentation says so. Nx 24 runs a runtime input through `sh -c` in the repository root, so the toolchain command can change into the workspace root first ([[EVD-NX-24-INPUT-SEMANTICS]]).
:::

:::mara decision ADR-CI-LINUX-ONLY
:mid: 01M78KFR0QP1XDDHMYRA2RTNET
:title: Run CI on Linux only for the moment
:status: accepted
:accepts: RISK-MACOS-UNVERIFIED

GitHub's hosted macOS runners are in short supply in November 2026, so jobs on them wait long or do not start. The plugin is a JavaScript package with no platform-specific build, so only test runs are affected: this repository's CI runs its unit and end-to-end tests on Linux only for the moment. macOS stays a supported host ([[ADR-COMPATIBILITY]]), and code must not assume Linux. What is deferred is the check: no macOS run backs the claim until the jobs are added, and [[VER-SETUP]] says so. When macOS runners are usable again, the macOS jobs are added to the workflow, the macOS part of the verification is restored, and this decision and its risk are retired.
:::

:::mara decision ADR-UNKNOWN-OPTIONS
:mid: 01M7A93PSWEZZPRGCDQCJ8DHE4
:title: Run tasks without options the executor does not know and say so in their output
:status: accepted
:justifies: REQ-UNKNOWN-OPTIONS
:justifies: REQ-UNKNOWN-METADATA-OPTIONS
:justifies: DES-UNKNOWN-OPTIONS

Rust targets share their names with JS targets ([[ADR-NX-TARGET-NAMES]]), so options written for JS executors reach the plugin's executors: from a `targetDefaults` entry such as `test: { options: { passWithNoTests: true } }`, from a `project.json` or `package.json`, and from flags such as `--coverage` on `nx affected -t test`, which Nx passes to every task of the target ([[EVD-NX-OPTION-VALIDATION]]). On 13 November 2026 the maintainer chose to run such a task as if the option were absent and to say so in the task's own output when it starts. Two reviews then found cases in which the plugin named a source that had not supplied the option. He decided on the same day that the line says the option was passed on the command line only when it is among the command's own flags, and otherwise that it comes from the workspace's configuration, naming the command that shows exactly where and the two fixes for a `targetDefaults` entry.

Rejected:

- **A closed schema** (`additionalProperties: false`). Nx then fails every task that it hands to the batch implementation, those without the option too, with an unhandled `SchemaError` that names neither the option nor a task, and `--verbose` adds nothing. That breaks [[REQ-BATCHING]], under which a task fails only for its own crate.
- **Failing the task**, with a clear message from the executor. Settings that mixed repositories use routinely would stop Rust tasks until every entry and flag was narrowed, although such an option changes nothing that cargo does.
- **Ignoring the option silently.** A misspelt option, or one the user expects to have an effect, would go unnoticed ([[NEED-CLEAR-FAILURES]]).
- **Reporting at graph creation.** As an error it stops every Nx command of the repository, JS ones included ([[REQ-DIAGNOSTICS]]). As a warning it reaches only the daemon's log on a developer machine. A flag on the command line is not in the graph at all.
- **Naming the file or the `targetDefaults` key** that gave the option. Two reviews found cases in which a reconstruction of Nx's merge from the executor's context named a source that had not supplied the option ([[EVD-NX-OPTION-VALIDATION]]). Nx records the source in its own source map, which `nx show target` shows, and the line names that command instead.

Ignoring is safe for the cache: Nx keeps the option in the task's key, so a run with another value runs again instead of restoring a result made without it ([[GOAL-TRUSTED-CACHE]]). The costs are that a misspelt Rust option set through a target default or a flag only warns, and that the warning repeats on every run until the entry is narrowed. A declared option with a value of the wrong type still fails every task that Nx hands to the batch implementation with it, with Nx's message, because the option types stay in the schema for Nx's conversion of command-line values.

The plugin's own tables in Cargo manifests are treated differently. The plugin owns that source and knows at graph creation which options its executors have, so an unknown key under a target's `options` or one of its configurations there fails graph creation, the earliest point at which the mistake is known, and names the manifest, the target, the configuration if any, and the key ([[REQ-DIAGNOSTICS]]).
:::

:::mara decision ADR-NO-ERROR-CODES
:mid: 01M7A67WRX56A7M56CJZ7VF326
:title: Name problems in words, without error codes, in v1
:status: accepted
:justifies: DES-DIAGNOSTICS

A diagnostic says what is wrong, where, and what to do ([[REQ-DIAGNOSTICS]]). In v1 it carries no code. Nx 24 shows no numbered codes in its diagnostics, and the cargo messages seen while designing the generators carried none either ([[EVD-NX-24-SETUP]], [[EVD-CARGO-NEW]]), so a code would stand alone in a user's output. Once published, a code is an interface to keep stable and to document. Tests check the facts a message names instead.

Codes may be introduced later without breaking anything, because adding a code to a message takes away nothing a user or a script relies on. They would serve people or tools that need to refer to one problem across releases: a documentation page per problem, filtering warnings in a pipeline, or wording that changes often. One possible scheme is a stable code for each row of [[DES-DIAGNOSTICS]], listed in the setup guidance and never reused for another problem. Whether to introduce codes, and in what form, is decided when such a need arises.
:::

:::mara decision ADR-DECLARED-FILE-INPUTS
:mid: 01M7ACMK1QTQXRJFFNXHPB53FS
:title: Declare files outside a crate instead of learning them from builds
:status: accepted
:justifies: REQ-BUILD-SCRIPT-INPUTS
:justifies: REQ-FILE-INPUTS-HASHABLE
:justifies: REQ-BUILD-INPUT-CHECK
:justifies: DES-INPUTS
:justifies: DES-BUILD-INPUT-CHECK

A build script, a macro or a test can read files outside its crate's folder, which the crate-file input does not cover. The cache key has to name such files before the task runs, and nothing reports them then: neither the `cargo metadata` report nor Cargo's JSON messages carry them ([[EVD-CARGO-NO-DEPS]], [[EVD-CARGO-DEP-INFO]]). Only Cargo's records of a finished build do. The repository therefore declares these files in its Cargo manifests under `fileInputs`, and the plugin turns each pattern into an Nx fileset. The key is named to pair with the keys that add environment variables and commands to the key.

Three alternatives were rejected:

- **Learning the paths from earlier builds.** Only `cargo build` leaves a documented record, the dependency file beside each artifact. The records of `check`, `lint`, `test` and `doc` exist only in the build directory, whose layout moved between Cargo 1.97 and 1.100 and which the plugin never reads ([[DES-BUILD-DIRS]]). Records exist per machine and only after a build, so a fresh CI checkout has none: its first run would either compute a key without the files, which a shared cache could later answer with a result built from other files, or a key that never hits. Carried in a runtime input, the learned files would change keys but never make a task affected, because task-based affected matches changed files against declared file inputs only ([[ADR-DECLARED-INPUTS]], [[EVD-NX-24-INPUT-SEMANTICS]], [[EVD-NX-24-FILE-INPUTS]]).
- **Scanning `build.rs` and the sources for literal paths.** Build helpers such as tauri-build and bindgen print `rerun-if-changed` for paths they compute, and a proc macro can open files itself ([[EVD-CARGO-DEP-INFO]]). A scan would find a part and suggest it found all.
- **Leaving the files out of v1.** A runtime command under `runtimeInputs` that hashes the files changes keys, but `nx affected` ignores it. A change to a shared protocol definition would then leave `nx affected -t build` green without building the crates that embed it, which [[NEED-AFFECTED]] rules out.

A declaration also covers what no record shows: a file that a proc macro opens by itself, which Cargo does not track either. Its cost is that the repository has to state the files. To catch what it forgot, a `build` task that ran cargo compares the dependency files Cargo wrote with its inputs, and fails when one names a repository file that no input covers ([[REQ-BUILD-INPUT-CHECK]]). It fails instead of warning because Nx stores every successful result and an executor cannot report success without it being stored, so a warning would leave a result under a key known to miss a file ([[EVD-NX-24-FILE-INPUTS]]). Nx Cloud can record the files a task reads, but nothing records them without it, so that is no substitute.
:::

:::mara decision ADR-GRAPH-NO-TOOLCHAIN-INSTALL
:mid: 01M7AN094P6S3K7M62DNC8P15H
:title: Let rustup install no toolchain while the graph or a cache key is computed
:status: accepted
:justifies: DES-METADATA-REPORT
:justifies: DES-INPUTS
:justifies: DES-DIAGNOSTICS

A workspace's `rust-toolchain.toml` can pin a toolchain that the machine lacks, and rustup installs such a toolchain the first time a command needs it, unless `RUSTUP_AUTO_INSTALL=0` is set ([[EVD-RUSTUP-MISSING-TOOLCHAIN]]). The plugin runs cargo whenever Nx creates the project graph, also on a machine that only works on JS projects. It therefore runs every cargo command of graph creation with `RUSTUP_AUTO_INSTALL=0`: a pinned toolchain that is missing fails graph creation with rustup's message, which names it, and creating the graph downloads nothing ([[ADR-V1-SCOPE]]). Where cargo is no rustup proxy, the variable has no effect. The cargo commands of tasks get no such setting, so a task installs a missing toolchain exactly when the same plain cargo command would ([[REQ-CARGO-UNCHANGED]]).

The toolchain input of a task's key runs `rustc -Vv` with the variable as well. Nx 24.0.6 cannot fail a task from a runtime input: it keys the task on what the command prints and runs it ([[EVD-RUSTUP-MISSING-TOOLCHAIN]]). When the toolchain is missing, the input therefore yields a value that never repeats, so that no result stored under that key can be restored, and the task runs as plain cargo does. The message that names the toolchain comes from graph creation, which fails first in nearly every case.

Leaving rustup's default was rejected, because `nx graph`, or any Nx command that creates the graph or computes a key, could then download a toolchain unasked. Setting the variable for tasks as well, or failing a task from the executor when its toolchain is missing, was rejected, because a task would then fail where the same plain cargo command succeeds. Keying the task on rustup's message was rejected, because the message names a channel such as `stable` and not the release that cargo would install, so a result could be restored for another toolchain.
:::

:::mara decision ADR-REDIRECTION-EDGES
:mid: 01M7AQ58FTSJX0AWN2BGZF4TND
:title: Give the crates that [patch], [replace] and paths redirect to edges from every member that may use them
:status: accepted
:justifies: REQ-DEPENDENCY-EDGES
:justifies: DES-PROJECT-GRAPH
:justifies: DES-METADATA-REPORT
:justifies: DES-INPUTS
:justifies: DES-DISCOVERY
:justifies: DES-DIAGNOSTICS
:justifies: REQ-INPUT-FILES

Agreed with the maintainer on 13 November 2026. Through `[patch]`, `[replace]` and `paths`, cargo builds a local crate in place of a registry or git dependency, and the graph's `--no-deps` report shows none of them. Without more, a crate that cargo builds against another crate of the repository this way has no edge to it, and neither `nx affected` nor its cache keys follow that crate ([[EVD-CARGO-REDIRECTIONS]], [[GOAL-TRUSTED-CACHE]]).

The plugin therefore reads the tables from files when it creates the graph: `[patch]` and `[replace]` from each workspace's root manifest, and `[patch]` and `paths` from the configuration files that cargo reads for the workspace's tasks. That needs no cargo call, no network and no `Cargo.lock`. It is the one place where the plugin parses Cargo's files itself, and it makes a TOML parser a dependency of the plugin.

The files say neither whether cargo uses a redirected crate nor which crates reach it, through a registry crate or through a path crate of another workspace. Every member with a registry or git dependency, of its own or of a path crate it reaches, therefore gets an edge to every redirected crate with a project but itself. That is a superset: no edge is missing, so keys and `nx affected` are right, and the graph may show edges that cargo does not have.

Where the redirected crate reaches the member through normal or build dependencies, cargo would reject the member's use of it as a cycle, so only the member's dev-dependencies can lead there. The edge would close a cycle that cargo never has, which a user's `dependsOn: ["^build"]` turns into a task cycle that fails the run ([[EVD-NX-24-INSPECTION]]). That edge is left out, and the member's targets get the redirected crate's files as an input instead. Where the redirected crate reaches the member only through a dev-dependency, the edge stays, as [[ADR-ALL-DEP-KINDS]] keeps such cycles.

The review of the change refined this on 13 November 2026, without changing the answers above: a dependency whose name, source and version requirement a redirected crate satisfies is resolved to it by cargo, so that edge is real and always kept, and it counts among the real dependencies that leave a possible edge out. A requirement that the redirected crate does not satisfy is no redirection. Two redirected crates that may only possibly use each other get no edge either way, but each other's files as an input, because cargo can have at most one direction and the plugin cannot tell which ([[DES-PROJECT-GRAPH]]).

A configuration file outside the repository, such as the Cargo home's, applies like one inside it, and the plugin warns that Nx does not see changes to it.

Rejected: edges only from the members that declare the redirected crate's name, which miss the uses through registry crates and through other workspaces' crates; a resolved `cargo metadata` report, which needs the network or a filled Cargo home and writes `Cargo.lock`, or with `--locked` fails while it is stale ([[ADR-METADATA-NO-DEPS]]); reading `Cargo.lock` while the graph is created, which still needs the tables for the crates' folders, holds no trace of `paths` and needs the superset whenever the lockfile is stale; a warning or an error in place of edges; and inputs in place of edges, which neither the `^` inputs of the member's dependents nor the project graph follow.
:::

## Risks

Several risks below are assumptions that the design rests on and that nobody
has checked yet. Each of those has a spike in the backlog, and milestone 1.0
closes them.

:::mara risk RISK-METADATA-KEY-COLLISION
:mid: 01M78FHG7F58QYEVQ7DX5KNQK5
:title: Another tool claims the nx metadata key
:status: accepted
:likelihood: unlikely
:consequence: moderate
:threatens: NEED-CONFIG-IN-CARGO

Another Nx plugin for Rust, or Nx itself, could start reading `[package.metadata.nx]` with a different meaning. Manifests would then carry settings two tools interpret differently, and one of them would have to move to another key. [[ADR-METADATA-KEY]] accepts this.
:::

:::mara risk RISK-TARGET-DEFAULTS
:mid: 01M78FHG7FAJAK7K2EN2P4XE8C
:title: Target defaults written for JS reach Rust targets
:status: accepted
:likelihood: likely
:consequence: major
:threatens: NEED-EFFICIENT-BUILDS
:threatens: NEED-CORRECT-CACHE

Because Rust targets share the names `build`, `lint` and `test` with JS targets, a `targetDefaults` entry keyed by a bare name applies to them. Nx 24 lays the entry over the inferred target: its `dependsOn`, `inputs`, `outputs` and `cache` replace the inferred values unless a list keeps them with `"..."`, and its `options` reach the executor ([[EVD-NX-TARGET-DEFAULTS]]). A `dependsOn: ["^build"]` then adds a build of every crate a crate depends on ([[EVD-NXRUST-BUILD-DEPS]]); batching ([[DES-BATCH]]) puts them in one batch with the build that needs them. An `inputs` list written for a JS tool drops the toolchain, environment and workspace inputs from the key, so a result built under other settings is restored. An `outputs` list drops the artifacts, so a cache hit restores no binary, and `cache: true` caches the targets that the plugin leaves uncached because their artifacts lie outside the repository. A `filter` on projects, plugin or executor keeps an entry away from Rust targets ([[EVD-NX-24-INSPECTION]]), but a `plugin` filter cannot select targets from `package.json` scripts or `project.json` files. The executor runs a task without the options it does not know and says so in the task's output, which mitigates what an entry's options do ([[REQ-UNKNOWN-OPTIONS]]). [[REQ-TARGET-DEFAULT-GUARD]] is the planned mitigation for the rest.
:::

:::mara risk RISK-UNDECLARED-INPUTS
:mid: 01M78FHG7F7QAFW6P09CQYEPJA
:title: A task reads something its cache key does not cover
:status: accepted
:likelihood: possible
:consequence: major
:threatens: GOAL-TRUSTED-CACHE
:threatens: NEED-CORRECT-CACHE

A build script, proc macro or test can read files outside the crate, environment variables outside the allowlist, or the network. A change there does not change the key, and a stale result is restored. The plugin declares what it knows: it hashes the whole folder of a crate and of a path dependency without a project, and warns where Nx cannot see such a dependency's files. A repository adds the files outside a crate that the crate reads ([[REQ-BUILD-SCRIPT-INPUTS]]), and variables and commands. A `build` that ran cargo fails when Cargo's dependency files name a repository file that no input covers ([[REQ-BUILD-INPUT-CHECK]]).

What remains: a file that a proc macro opens without an include macro, which Cargo does not track and no dependency file shows; files that only `check`, `lint`, `test` or `doc` read, or that tests open at run time, since Cargo records those reads only in its build directory or not at all; any undeclared read of a crate whose `build` does not run through Nx, as in a pipeline that runs only `lint` and `test`; files outside the repository, which Nx cannot hash; environment variables outside the list; and the network ([[EVD-CARGO-DEP-INFO]]). Without a sandbox the plugin cannot detect these. [[ADR-V1-SCOPE]] accepts this.
:::

:::mara risk RISK-HOST-ENVIRONMENT
:mid: 01M78FHG7F36BVH0EP3K2REH3E
:title: A result is restored on a machine that differs in ways the key cannot see
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: NEED-CORRECT-CACHE

The key contains the toolchain, including the host triple, and the target triple. It does not contain system libraries, the linker, the C toolchain version, or Cargo and tool configuration outside the repository, such as `$CARGO_HOME/config.toml` or a rustfmt configuration in the home directory. With a cache shared between unlike machines of one triple, a test result or a dynamically linked binary from one can be restored on another where it would behave differently. A repository can add a runtime input that tells its machines apart. [[ADR-V1-SCOPE]] accepts this.
:::

:::mara risk RISK-SUBSET-AS-FULL
:mid: 01M78FHG7FECGDXGMB8MB75DPD
:title: A subset test result is reused as a full-suite result
:status: accepted
:likelihood: unlikely
:consequence: severe
:threatens: REQ-TEST-MODE-KEY
:threatens: GOAL-TRUSTED-CACHE

If the result of running selected tests were stored under the key of the full suite, the main branch could show green for tests that never ran. [[DES-TEST-MODE]] prevents it by putting the mode and the baseline commit into the key. The remaining exposure is the mode command reporting another mode than the one the task runs in, for example when Nx reuses an old evaluation or runs the command in another environment than the task ([[RISK-NX-INPUT-SEMANTICS]]).
:::

:::mara risk RISK-NX-INPUT-SEMANTICS
:mid: 01M78FHG7FWVEHYKF3KRPQYTWN
:title: Nx evaluates inputs differently from what the design assumes
:status: accepted
:likelihood: unlikely
:consequence: major
:threatens: REQ-TEST-MODE-KEY
:threatens: REQ-TOOLCHAIN-KEY
:threatens: NEED-AFFECTED
:threatens: REQ-ENV-ALLOWLIST

The design assumed that a runtime input is evaluated afresh on each run, also under the Nx daemon; that its command runs through a shell from the repository root, so that it can change into a workspace folder, and with the environment of the `nx` command; that task-based affected treats runtime inputs and batched tasks the way the cache does; and that `^` inputs hash stably when projects form a cycle. Nx 24.0.6 confirms most of this ([[EVD-NX-24-INPUT-SEMANTICS]]). It evaluates a runtime input once per task of every run, also under the daemon, through `sh -c` in the repository root, with the environment of the `nx` command plus the dotenv files it loads for the task. Batched and unbatched runs select the same tasks and share their keys, and `^` inputs hash stably over a project cycle. Two differences remain.

In a batch, Nx computes each task's key with an environment it rebuilds for that task from dotenv files, but starts the batch process with the environment of the `nx` command, into which it loaded only the root `.env`, `.env.local` and `.local.env`, and in another order of priority. The two differ when a file in the crate's folder or a root file named for a target or configuration, such as `.env.test`, sets a variable; when `.env.local` and `.local.env` set it differently; and when a shell value equal to a root file's value is unloaded for the task ([[EVD-NX-24-INPUT-SEMANTICS]]). A test mode, a toolchain or a listed variable is then in the key of a task that runs with another value. A result could be stored under a key that does not describe it, a subset result under the full-suite key among them ([[RISK-SUBSET-AS-FULL]]). This takes batching and dotenv files that set one of these variables. [[DES-BATCH]] rebuilds each task's environment from the same files and runs every cargo call with it. That copy of Nx's loading is the remaining exposure: a later Nx that reads other files, or in another order, would bring the gap back.

Task-based affected selects tasks by changed files, never by environment variables or the output of runtime commands. A toolchain update without a change to a toolchain file, or a new value of a listed variable, makes no task affected, although it changes the keys. A task that does run still misses the cache, so no stale result is restored, but `nx affected` does not run the tasks such a change reaches.
:::

:::mara risk RISK-BATCH-BEHAVIOUR
:mid: 01M78FHG7FARJNEMM2EFX7XFY9
:title: Nx batches behave worse than the design needs
:status: accepted
:likelihood: likely
:consequence: moderate
:threatens: REQ-BATCHING
:threatens: NEED-EFFICIENT-BUILDS

Since Nx 22.7 no other task starts while a batch runs, so in a mixed repository JS tasks wait for the Rust batch. Per-task results and per-task caching from a batch executor also still have to be confirmed on the supported Nx versions. [[ADR-BATCH-EXECUTOR]] accepts the waiting; a failure of per-task caching would need a different design.
:::

:::mara risk RISK-HAKARI-GAPS
:mid: 01M78FHG7F2NTRC9DZ1NMXWY7V
:title: cargo-hakari does not unify everything the plugin relies on
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-STABLE-FEATURES

cargo-hakari's documentation describes unification of third-party dependencies only. If it does not unify features that one workspace crate enables on another, building only the selected crates gives batch-dependent results. [[DES-UNIFICATION]] detects such features and falls back to building the whole workspace, which costs time where it applies. A stale hack crate and features masked by it are covered by the drift check and the optional strict build. To check with a small workspace.
:::

:::mara risk RISK-CARGO-AFFECTED
:mid: 01M78FHG7F5EH60R4TW2E645EW
:title: cargo-affected does not deliver what the test design assumes
:status: accepted
:likelihood: possible
:consequence: major
:threatens: REQ-AFFECTED-TESTS
:threatens: NEED-FAST-TESTS

cargo-affected describes itself as very early. The design assumes that `status --report-json --report-detail full` lists tests precisely enough to build a nextest filter and to map results to crates, and that `status` is cheap although it lists tests through nextest, which needs built test binaries. If either fails, selection costs more than it saves or cannot be done. The selector is a replaceable step and the feature is off by default. To check on a real workspace.
:::

:::mara risk RISK-COVERAGE-COST
:mid: 01M78FHG7F5ES0QNZ84J94JZQ2
:title: Collecting coverage costs too much on main
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: NEED-FAST-TESTS

The baseline needs `cargo affected collect` or `collect --diff` on every main commit. Instrumented builds and runs are slower and use a different build configuration. If the overhead is large, the main pipeline slows down more than pull requests speed up. To benchmark on a real workspace; a separate build directory for coverage builds is available as a switch.
:::

:::mara risk RISK-BASELINE-DRIFT
:mid: 01M78FHG7F90XWFCQ150XBFKGM
:title: Selection gets noisy as the baseline falls behind
:status: accepted
:likelihood: possible
:consequence: minor
:threatens: NEED-FAST-TESTS

A pull request compared against an older baseline has a wider diff and selects more tests. How quickly that happens is inferred from how cargo-affected stores its data, not measured. The consequence is lost time, not a wrong result. The full recollect threshold in [[DES-BASELINE]] is the control. To measure.
:::

:::mara risk RISK-UPSTREAM-CHANGES
:mid: 01M78FHG7F662HG5KVZQEN15Z3
:title: Unstable upstream interfaces change under the plugin
:status: accepted
:likelihood: likely
:consequence: moderate
:threatens: NEED-EFFICIENT-BUILDS
:threatens: NEED-FAST-TESTS

Several things the plugin uses are not stable: Cargo's `resolver.feature-unification`, whose name or values could still change; the layout of the build directory, which changed in Cargo 1.100; cargo-affected's commands and report format; and Nx's batch executor interface. The plugin avoids the build directory layout entirely, keeps the `cargo` strategy experimental and the selector replaceable, and supports only the Nx majors it has been verified on ([[ADR-COMPATIBILITY]]). To track Cargo's stabilisation.
:::

:::mara risk RISK-MIXED-PROJECT-MERGE
:mid: 01M78FHG7FMS3SAP65G9TME7FF
:title: Two plugins describe one folder differently
:status: accepted
:likelihood: almost-certain
:consequence: moderate
:threatens: NEED-JS-BRIDGE
:threatens: REQ-WORKSPACE-PROJECT
:threatens: REQ-PROJECT-NAMES

A napi or wasm crate usually has `Cargo.toml` and `package.json` side by side, so this plugin and Nx's `package.json` plugin both create a project for the folder. Nx merges them into one project, and it applies `package.json` and `project.json` after every plugin listed in `nx.json` ([[EVD-NX-PROJECT-MERGE]]). The project is therefore named by `package.json`, or by a `project.json` that sets a name, and not after the crate. A script or `project.json` target that has the name of an inferred target, such as `build` or `test`, and runs something else replaces the inferred target, with its cache settings and inputs, without a message. The same happens to the workspace project when a Cargo workspace sits in a folder that already is an Nx project, such as a repository root with a `project.json` or with an `nx` key in its `package.json`. An edge that names such a project by its crate name is dropped without a message or fails graph creation, while a `dependsOn` entry that names it is rewritten to the new name. [[REQ-MIXED-PROJECTS]] is the planned mitigation. Checked on Nx 24.0.6; to check again on each Nx major the plugin supports.
:::

:::mara risk RISK-NAPI-TOOLING
:mid: 01M78FHG7F2Q33HWV789RWB7T7
:title: The napi CLI does not fit the two-step build
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-ARTIFACT-TARGETS

[[DES-NAPI]] assumes that the napi CLI can post-process an existing cargo build, so that compiling stays in the batch. If the CLI insists on running cargo itself, `napi-build` leaves the batch and takes the build lock on its own. It is also unknown whether napi crates need a special feature to link under `cargo test`. To check both.
:::

:::mara risk RISK-MACOS-UNVERIFIED
:mid: 01M78KFPPYBZHRM9B41K0TG46Q
:title: macOS support breaks without anyone noticing
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-COMPATIBILITY

While CI runs on Linux only, nothing runs the plugin on macOS. A change that works on Linux can fail there, for example through a case-insensitive file system, a different linker and library naming for Node addons, or different toolchain paths, and the failure reaches users first. Until macOS runs exist, the claim that macOS is supported rests on the design and not on test runs. [[ADR-CI-LINUX-ONLY]] accepts this for the moment.
:::

## Evidence

:::mara evidence EVD-NXRUST-GAPS
:mid: 01M78FHG7F71QFJZNFBAATR6N4
:title: Gaps found in nxrust v0.3.0
:status: accepted
:supports: ADR-NEW-PLUGIN

Reading eddacraft/nxrust at v0.3.0 (last commit 22 October 2026) on 12 November 2026, in particular its product specification, its cache and toolchain design, `src/graph.ts`, `src/utils/cache-inputs.ts` and `plans/issues.md`, showed:

- Dev-dependencies are dropped from the graph, so a change in a dev-only workspace crate does not invalidate the dependent's cached tests.
- The whole `Cargo.lock` is an input, so any lockfile change invalidates every crate.
- There is no batching and no handling of feature unification.
- `build.rs` `rerun-if-changed` paths and intermediate `.cargo/config.toml` files are not hashed.
- The `cargo metadata` cache is in memory only, and the Cargo workspace must sit at the Nx root.
- `build` restores `rlib` files into Cargo's `target/`.

This is a reading of source and documents, not a test of the plugin.
:::

:::mara evidence EVD-NXRUST-BUILD-DEPS
:mid: 01M78FHG7FKCEAGRQKJ36NF8WZ
:title: Inherited ^build turned a 52-second test run into 40 minutes
:status: accepted
:supports: ADR-NO-RUST-BUILD-DEPS
:supports: RISK-TARGET-DEFAULTS

nxrust's issue log records this as ISS-001, "Cross-language ^build inheritance amplifies cargo lock contention" (`plans/issues.md`, lines 8 to 31, in eddacraft/nxrust at commit 53572b2 of 22 October 2026). The measurement comes from nxrust's consumer workspace, eddacraft/anvil-001, pull request #1729. There, JS tests inherited `^build` across to the Rust crates, and `pnpm test` took 40m03s. After the script was split into `test:js && test:rust` it took 31 to 52 seconds, a 46-fold speedup. The entry states that the useful work was about 52 seconds and that the rest was cargo builds queued on the `target/` lock. The same figures are cited in `plans/modules/10-wasm-napi.aps.md`, under the cross-language `dependsOn` contract.

This is a secondary record: what was read, on 12 November 2026, is nxrust's account of the measurement, not the anvil-001 pull request itself. The measurement was not reproduced here.
:::

:::mara evidence EVD-NX-24-INSPECTION
:mid: 01M78FHG7F32NTNKGXVJT9QA2A
:title: What Nx 24.0.6 declares about batching, inputs, cycles and affected
:status: accepted
:supports: ADR-ARTIFACT-TARGET-NAMES
:supports: ADR-BATCH-EXECUTOR
:supports: ADR-DECLARED-INPUTS
:supports: ADR-ALL-DEP-KINDS
:supports: ADR-COMPATIBILITY
:supports: ADR-NO-RUST-BUILD-DEPS
:supports: ADR-TEST-MODE-CHOICE
:supports: RISK-TARGET-DEFAULTS

Inspection of the `nx` 24.0.6 package installed in this repository, on 12 November 2026:

- **`dependsOn`.** An object entry accepts `projects`, `dependencies`, `target`, `params`, `options`, `inputs` and `waitFor`, and no other property (`schemas/project-schema.json`). Nothing selects a configuration of the dependency's target.
- **`^` dependencies.** An entry with `dependencies: true`, which is what `^build` stands for, adds the named target of every project the task's project depends on that has it. For a dependency without that target, the walk continues to that project's own dependencies. Nothing lets a plugin, or the project depended on, exclude itself (`tasks-runner/create-task-graph.js`).
- **Batching.** An `executors.json` entry accepts `batchImplementation` and `preferBatch`. Without `--batch`, the scheduler batches a task only when its executor sets `preferBatch`. It forms one batch per executor, from the runnable tasks of that executor and the tasks of the same executor that depend on them (`tasks-runner/tasks-schedule.js`).
- **Custom hashers.** The `hasher` entry and its types are marked "deprecated: Use target inputs instead. This will be removed in Nx 25".
- **Affected.** `affected.legacy` in `nx.json` is described as "Select every task of each affected project, instead of only the tasks whose inputs a change reaches" and defaults to `false`, so selection by task inputs is the default.
- **Cycles.** Running a command fails with "the task graph has a circular dependency" when tasks form a cycle, unless `NX_IGNORE_CYCLES` is set (`tasks-runner/run-command.js`). No check that rejects a cycle between projects was found.
- **Target defaults.** A `targetDefaults` value can be an array of entries, each with a `filter` on `plugin`, `projects` or `executor`.
- **Inputs.** Input kinds include `fileset`, `runtime`, `env` and `externalDependencies`.
- **Plugin interface.** `createNodes` receives all matching files at once and may return `externalNodes`; `createNodesV2` is a deprecated alias. A plugin entry in `nx.json` accepts `include` and `exclude` lists beside `options` (`config/nx-json.d.ts`).
- **Option overrides.** The options passed on the command line are part of a task's hash (`hasher/task-hasher.js`).
- **CI detection.** `isCI()` reports CI when `CI` is set to anything but `false`, or when one of the variables that the common CI systems set is present, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `BUILDKITE` (`utils/is-ci.js`).

This is a reading of type definitions, schemas and compiled source. It shows what Nx declares, not how it behaves in every case; behaviour is checked by the spikes named under the risks.
:::

:::mara evidence EVD-NX-TARGET-DEFAULTS
:mid: 01M7A0NA0X5XDW6MEQNS90EWC2
:title: How Nx 24.0.6 lays target defaults over inferred targets
:status: accepted
:supports: RISK-TARGET-DEFAULTS
:supports: ADR-NX-TARGET-NAMES

An experiment on 13 November 2026 with `nx` 24.0.6, Node.js 26.12.0, pnpm 12.18.0 and rustc 1.100.0, in a throwaway pnpm workspace outside this repository. A stand-in plugin, listed in `nx.json` by its package name, made projects of two crates, `app` and its path dependency `core-lib`, and gave each the `build` and `test` targets that [[DES-TARGETS]] and [[DES-INPUTS]] describe: no `dependsOn`, `cache: true`, a named input for the crate folder with its `^` form, an `env` input for `RUSTFLAGS`, a `runtime` input for `rustc -Vv`, and an executor with `batchImplementation` and `preferBatch`. The executor ran no cargo; it recorded what it received and wrote a file into the declared output. Beside the crates were a JS project whose `build` is a `package.json` script and one whose `build` came from a second stand-in plugin. Each variant of `targetDefaults` was read back with `nx show project <name> --json`. Runs used `nx run <project>:build --output-style=static`, with `NX_DAEMON=false` and `NX_CACHE_DIRECTORY` set to a folder that was emptied before each variant. The Nx sources read alongside are `project-graph/utils/project-configuration-utils.js`, and `target-defaults.js` and `target-merging.js` in `project-graph/utils/project-configuration/`.

- **Precedence.** Nx merges the targets of the plugins listed in `nx.json` first, then target defaults, then the targets of `project.json` and `package.json` files. A target default therefore overrides an inferred target, and a project's own file overrides the target default.
- **Replaced, not merged.** An entry keyed `build` with `dependsOn: ["^build"]`, `inputs: ["default", "^default"]`, `outputs: ["{projectRoot}/dist"]` and `cache: false` replaced each of these four values on both crates. A field the entry does not set kept its inferred value. `options` were merged key by key, and the executor received the entry's option beside the inferred ones.
- **Options.** An entry keyed `test` with `options: { passWithNoTests: true }` passed the option to the executor. With `additionalProperties: false` in the executor's schema, `nx run core-lib:test` failed instead, and the batch worker printed only an unhandled rejection with a `SchemaError`, naming neither the option nor the entry.
- **Spread.** A list containing `"..."`, such as `inputs: ["...", "{workspaceRoot}/.tool-versions"]`, kept the inferred entries in that place and added the others.
- **Cache key.** With `inputs: ["default", "^default"]` from a default, `nx run core-lib:build --exclude-task-dependencies` ran with `RUSTFLAGS` unset and then with `RUSTFLAGS=-Copt-level=1`. The second run restored the first result from the cache, including the file written under the empty `RUSTFLAGS`. Without the entry, or with `"..."` in its list, the second run executed.
- **Outputs.** With `outputs: ["{projectRoot}/dist"]` from a default, a second run after deleting the inferred output folder was a cache hit that restored no file. Without the entry the hit restored the file.
- **Task graph.** With `dependsOn: ["^build"]` from a default, `nx run app:build` also ran `core-lib:build`. Both tasks reached the executor in one batch, and the task graph in the executor's context held the dependency.
- **Filters.** Array entries with `filter.plugin` set to the JS stand-in's name, with `filter.projects` set to `["tag:lang:js"]`, `["!tag:lang:rust"]` or `["packages/*"]`, where the crates carried the tag `lang:rust`, or with `filter.executor` set to `nx:run-commands` all left the crates' targets as inferred. `filter.plugin` compares with the `name` a plugin module exports or, if it exports none, with its entry in `nx.json`. It matched no target from a `package.json` script, not even as `nx/core/package-json`: Nx records a source plugin only for targets from the plugins listed in `nx.json`.
- **Key precedence.** A key naming the target's executor is chosen before the key naming the target, even when its value is empty. With an empty entry keyed by the stand-in's executor beside a `build` entry, the crates' `build` stayed as inferred and the JS `build` targets took the `build` entry. An entry that sets another `executor`, such as `@nx/js:tsc`, was dropped for targets with a different executor.
- **What a plugin sees.** `createNodes` receives `targetDefaults` as written in `nx.json`, not the merged targets. `createDependencies` receives `context.projects` with the merged targets. The batch executor found the merged target in `context.projectsConfigurations` and the added dependency in `context.taskGraph`. Nx's resolver for target defaults, `readTargetDefaultsForTarget`, is exported only from `nx/src/devkit-internals`.

The stand-ins ran no cargo, so this shows how Nx merges, hashes and schedules targets of this shape, not what inherited builds cost in time.
:::

:::mara evidence EVD-NX-OPTION-VALIDATION
:mid: 01M7A93PSWDSC2D81P6MX8WZZ7
:title: How Nx 24.0.6 checks, hashes and reports options of a batch executor
:status: accepted
:supports: ADR-UNKNOWN-OPTIONS
:supports: DES-UNKNOWN-OPTIONS
:supports: RISK-TARGET-DEFAULTS
:supports: DES-TARGET-COMMANDS

An experiment on 13 November 2026 with the `nx` 24.0.6 package that this repository installs, Node 26.12.0, on Linux, in a throwaway workspace outside this repository, together with a reading of that package (paths below are under `dist/src/`). A stand-in plugin, listed in `nx.json` by its package name, made projects of two crates, `core-lib` and `app`, from their `Cargo.toml` files, tagged `lang:rust`, each with `build` and `test` targets that had `cache: true`, the crate's folder as their only input, an output folder and empty `options`. Their executor ran no cargo: it wrote the options it received, the task's overrides and the `targetDefaults` in its context into the task's output. It came in four variants, each with a schema that declared `features` (a list of strings) and `profile` (a string): with `batchImplementation` and `preferBatch: true`, or without them, and in each case once with `additionalProperties` unset and once with `additionalProperties: false`. `createNodes` and `createDependencies` recorded what they received, and could throw or warn. Unless a case says otherwise, commands ran with `NX_DAEMON=false`, `NX_TUI=false` and an emptied `NX_CACHE_DIRECTORY`: `nx run core-lib:test` and `nx run-many -t test build`, with `--output-style=static`, and with `--batch=false`, `--verbose` or flags such as `--coverage --ci` where stated, as well as `nx show projects` and `nx show project core-lib --json`. Hashes were read with `HashPlanInspector.inspectTask` and with `hashTask` of the in-process task hasher (`hasher/hash-plan-inspector.js`, `hasher/create-task-hasher.js`). The `targetDefaults` entry was `test: { options: { passWithNoTests: true } }` unless a case says otherwise. For the reviews of the same day, these were added: a `project.json` or `package.json` in a crate's folder, a `preTasksExecution` hook in the stand-in plugin, `nx show target core-lib:test --json`, `dependsOn` entries with `options` and `params` set to `"forward"` or left at `"ignore"`, a target that starts another through devkit's `runExecutor`, and an `args` option declared as a string, as a list of strings or as either. The executor computed for each unknown key whether it was a flag both in the task's own `__overrides_unparsed__` and in the `argv` that the hook recorded, and printed the result.

- **Where Nx checks options.** `combineOptionsForExecutor` (`utils/params.js`) merges a target's options, its configuration and the command line, and checks the result against the executor's schema. Nx calls it per task when the task runs: in the task's process (`command-line/run/run.js`, started by `bin/run-executor.js`) and in the batch process (`tasks-runner/batch/run-batch.js`). The batch process checks every task before it calls the batch implementation, outside its error handling. No caller runs while the graph is created.
- **Closed schema, one task per process.** With `additionalProperties: false`, and without a batch implementation or with `--batch=false`, each `test` task failed with `'passWithNoTests' is not found in schema` in its own output, and the `build` tasks succeeded.
- **Closed schema, batch.** With the batch implementation, `nx run core-lib:test` and `nx run-many -t test build` printed only Node's `UnhandledPromiseRejection: … The promise rejected with the reason "#<SchemaError>"` and failed every task of the batch, the two `build` tasks included, which had no unknown option. `--verbose` added nothing. `SchemaError` is not a subclass of `Error`. With the schema open, an entry that gave the declared `profile` the number 1 failed all four tasks in the same way. With `--batch=false`, and with the executor that has no batch implementation, only the two `test` tasks failed, each with `Property 'profile' does not match the schema. '1' should be a 'string'.`, and both `build` tasks ran.
- **Open schema.** The option reached the implementation for a single task and the batch implementation, there as `inputs[taskId]`, among the task's options. The task's overrides were in `context.taskGraph` for the implementation for a single task and in the task graph that the batch implementation receives, and both had the `targetDefaults` of `nx.json` in `context.nxJsonConfiguration`.
- **Command line.** `nx run-many -t test --coverage --ci` passed `coverage` and `ci` to every `test` task as overrides. With the closed schema and the batch implementation, every `test` task failed as above. Arguments after `--` arrived in the same way: `nx run core-lib:test -- --port 3000 serve` gave the options `port: 3000` and `_: ["serve"]`, as the same words without `--` did, and `__overrides_unparsed__` listed them without the `--`. When the command had `--`, Nx handed the task only the arguments after it, and dropped without a message the flags before it that Nx does not know itself, `--coverage` and also `--features=a`, which the schema declares: the task's header read `nx run core-lib:test --port 3000` (`withOverrides` in `command-line/yargs-utils/shared-options.js`). A `preTasksExecution` hook of the plugin received the command's `argv` with the `--` (`tasks-runner/run-command.js`). A value that the hook assigned to `process.env` reached the executor without a batch implementation with `NX_DAEMON=false` and with `NX_DAEMON=true`, for `nx run` and `nx run-many`, because Nx records such assignments and applies them to the `nx` process (`project-graph/plugins/loaded-nx-plugin.js`). A value returned from the hook did not arrive.
- **Cache key.** Each task's hash plan held `core-lib:ProjectConfiguration` and the file `nx.json`, although the target's inputs named only the crate's folder. Both tasks of a project had the same value of `ProjectConfiguration`. It changed when the entry's value changed from `true` to `false` and when the entry's `options` were emptied, so the hash of `build` changed as well as that of `test`. Nx passes the native hasher, for each target, its executor, `inputs`, `outputs`, `options`, `configurations` and `parallelism`, and for the project its root, named inputs and tags (`toRustProjectGraph` in `native/transform-objects.js`). With a `project.json` that the inputs left out, a change there to `options` or `configurations` of `test`, or to the project's tags, changed `ProjectConfiguration` and the hashes of both tasks. A change to `metadata`, `cache` or `dependsOn` of `test`, or to the project's `metadata`, changed neither. Only these changes, on targets of the stand-in's executor, were tried. For an `nx:run-script` target, Nx passes `metadata.scriptContent` with the options. With a script `lint` in a `package.json` of the crate's folder, which Nx read and the inputs left out, changing the script from `echo a` to `echo b` changed the hashes of `build` and `test`. A change to `nx.json` that touched no target of the crates, adding `defaultBase` and a `lint` entry, made both tasks run again instead of being restored from the cache. The command line enters each task's hash through `hashCommand` (`hasher/task-hasher.js`): `--passWithNoTests` changed the hashes.
- **What a plugin sees.** `createNodes` received `targetDefaults` as written in `nx.json`. `createDependencies` received the merged options, `{ "passWithNoTests": true }` on each `test`, as `nx show project core-lib --json` showed them, and its context type also offers `nx.json` (`project-graph/plugins/public-api.d.ts`), but no record of where an option came from. Nx keeps that record in `.nx/workspace-data/source-maps.json`, where an array entry gave `targets.test.options.passWithNoTests` the source `nx.json#targetDefaults.test[1]`, and resolves keys with `readTargetDefaultsForTarget`, which only `devkit-internals` exports. It tries the key named after the target's executor, then the target name, then glob keys longest first, and takes the first key with an entry whose `filter` matches, even an empty one. It evaluates `filter.projects` with `findMatchingProjects`, the matcher behind `--projects`, `filter.plugin` against the plugin that inferred the target and `filter.executor` against its executor (`project-graph/utils/project-configuration/target-defaults.js`).
- **Graph creation.** An error thrown in `createDependencies` failed every command, `nx show projects` included, with `Failed to process project graph. The "<plugin>" plugin threw an error while creating dependencies: <message>`. A `console.warn` in `createDependencies` was printed by every command with `NX_DAEMON=false`. With `NX_DAEMON=true`, the default outside CI and Docker (`daemon/client/client.js`), it appeared only in `.nx/workspace-data/d/daemon.log`.
- **Cache replay.** A cache hit printed the output that the task had produced, the executor's own line included.
- **Narrowing.** An empty entry keyed by the executor's name beside the `test` entry, or the `test` entry as an array whose element had `filter: { projects: ["!tag:lang:rust"] }`, left the crates' `test` without options.
- **Sources.** `nx show target core-lib:test --json` named, under `sourceMap`, the file or `targetDefaults` key behind each value of `options` and of each configuration. With `passWithNoTests: false` in `crates/core-lib/project.json`, the task received `false`, and `sourceMap` named that file, in three variants: beside the `test` entry, beside the `test` entry and an empty entry keyed by the executor, and beside a `test` entry whose `filter` excluded the crates. With `-c ci`, a value in the entry's `configurations.ci` won over the `project.json`'s `options`, and `sourceMap` named the entry for `configurations.ci.passWithNoTests`. `configurations.ci` from the entry and from `project.json` merged key by key, and a `defaultConfiguration` in `project.json` selected the configuration in a batch as `-c` does. Nx read a crate's `package.json`, and took the option from its `nx.targets`, only when the package manager's workspaces listed it or a `project.json` lay beside it, and then put `metadata.js` on the project. A call took about 0.25 s with the daemon and 0.35 s without, in this small workspace.
- **Forwarded options.** Nx gives a dependency task the dependent task's `options` and active configuration when the `dependsOn` entry has `options: "forward"`. It gives the command's overrides only with `params: "forward"`, and otherwise sets `__overrides_unparsed__` to an empty list (`createTaskOverrides` in `tasks-runner/create-task-graph.js`). With `options: "forward"` and the `test` entry setting `passWithNoTests`, `core-lib:build` received `passWithNoTests` among its overrides with an empty `__overrides_unparsed__`. With `params: "forward"` and `--coverage`, `build` received `coverage` and `["--coverage"]`. With both forwarded, `build` received both, and only `--coverage` in its list. With a plain `dependsOn`, `build` received no override. Across these cases, batched and unbatched, with `NX_DAEMON=false` and `true`, a key was a flag in both the task's own list and the recorded `argv` exactly when the user had typed it, also after `--`; a target started in code is the exception below. With `test` configured with `coverage`, `nx run core-lib:test -- -- --coverage` gave the overrides `_: ["--coverage"]` and the list `["--", "--coverage"]`, and the option kept its configured value. Spellings: `--pass-with-no-tests` arrived as the key `pass-with-no-tests`, `--no-coverage` as `coverage: false`, `--coverage=false` as the string `"false"`, and `-x` as `x`.
- **Started in code.** Devkit's `runExecutor` turns the options that its caller passes into overrides for the invocation it starts, an `__overrides_unparsed__` included. It passes the caller's context on unchanged, task graph included, so the started target gets no graph task of its own. It calls the target's single implementation, also for an executor that has a batch implementation (`command-line/run/run.js`). The started invocation's options are merged in this order: the target's options, which include `targetDefaults`; the configuration it runs with, which is the one the caller names or else the target's `defaultConfiguration`; and what the caller passes (`runExecutorInternal` there, and `combineOptionsForExecutor`). In each configuration below, a target `call` started `build` or `run` through `runExecutor`, with `NX_DAEMON=false` and with `NX_DAEMON=true`, and the outcome was the same in both:
  - `call` depended on `build` with `params: "forward"` and passed `{ coverage: "from-code" }`, with `nx run core-lib:call --coverage`. The graph task that the started `build` found held `coverage: true` and `["--coverage"]`. The earlier two-record rule gave the command-line form here, and the three conditions gave the general form.
  - The same, with `{ coverage: true }` passed: the three conditions gave the command-line form.
  - The same, with nothing passed and `build` configured with `coverage: true`: the three conditions gave the command-line form.
  - `call` depended on `run` with `params: "forward"` and passed `{ args: "--from-code" }`, with `nx run core-lib:call -- --port 3000`. The started invocation held no `port`. The earlier rule forwarded the arguments, and the three conditions forwarded nothing.
  - From the review of 13 November 2026: the same, with `options.port: 3000` on `run`. The started invocation held `port: 3000` and `args: "--from-code"`, and the three conditions forwarded the arguments.
  - The same, with `port: 3000` in `configurations.ci` of `run`. The arguments were forwarded when the caller named `ci` and when `ci` was the `defaultConfiguration`, and not forwarded when only the command had `-c ci`.
  - `params: "forward"` with `nx run core-lib:call -- --bin server`: the arguments were forwarded.
  - From the next review: `call` with `options: { coverage: true }` depended on `build` with `options: "forward"` and `params: "ignore"`, and passed `{ coverage: true }`, with `nx run core-lib:call --coverage`. The graph task held `coverage: true` and an empty `__overrides_unparsed__`, and the conditions gave the general form.
  - From the same review: `call` depended on `run` with `params: "ignore"` and passed `{ args: "--from-code" }`, with `nx run core-lib:call -- --bin server`. The graph task's list was empty, and nothing was forwarded.
  - The conditions gave the general form and forwarded nothing in each of these configurations: a value of another type (`"true"` for `true`, `"3000"` for `3000`); a different configured value; `--log-level` on the command line against `logLevel` passed in code; positional `-- serve`; and a caller that did not depend on the started target.
  - Ignoring. Twenty configurations were run: a caller running as a single task or in a batch; depending on `build` or `run` with `params: "forward"`, with `params: "ignore"` or not at all; and `build` with and without a batch implementation. In each, the started invocation received `fromCode: true`, which its schema did not declare, ran, printed its line, and the command succeeded. With a caller running as a single task, the line was part of the caller task's output and came back on a cache hit. With a caller running in a batch, the line was printed under the caller's header while it ran, but the cache hit replayed only the output that the caller's batch implementation returned.
- **Inherited records.** With `nx run core-lib:test -- --port 3000`, a `build` task that `test` depends on, also as a continuous task, had the hook's record of `--port 3000` in its environment but an empty `__overrides_unparsed__`. With `params: "forward"`, its list equalled the record.
- **`args`.** `--args="--port 3000"` arrived as the string `--port 3000` when the schema declared a string. When the schema allowed a list of strings, alone or as an alternative, it arrived as `["--port 3000"]`, and Nx split a string on commas, so `--args="--name 'a b',c"` became `["--name 'a b'", "c"]`. A repeated `--args` arrived as a list, which a string schema rejected with `Property 'args' does not match the schema`. Quotes, backslashes, an empty pair of quotes, `|`, `;`, `>` and `&&`, and an unterminated quote all arrived unchanged within the string. A value that looks like a number arrived as a number, which the string schema rejected: `--args=3000`, `--args="3000"`, `--args="'3000'"`, and `--args="1e3"` as `1000`. `--args=" 3000"` and `--args="3000 "` arrived as strings, `--args=true` as the string `true`, and `-- 3000` gave the task the list `["3000"]`. `--args --port 3000` without `=` gave `args: true`, which every schema rejected. Arguments after `--` that matched a declared option were checked as that option: `-- --profile` and `-- --profile 1` failed with `Property 'profile' does not match the schema`, while `-- --bin server --port 3000` arrived as `bin: "server"` and `port: 3000`. `-c ci` together with `--` kept the configuration.
- **Recomputing the source.** Two reviews of a design that recomputed from the executor's context which file or `targetDefaults` key had supplied an option found cases in which it named the wrong one. Reproduced here:
  - a `project.json` that overrode the entry, also beside an empty entry keyed by the executor or under a `filter` that excluded the entry;
  - a value in the entry's `configurations.ci` that won over the `project.json`'s `options` under `-c ci`;
  - a list assembled from two sources: the entry's `reporters: ["a"]` and the `project.json`'s `reporters: ["...", "b"]` gave `["a", "b"]`, and `sourceMap` named a source per element;
  - a requested configuration that the target lacks: `-c missing` ran with the `defaultConfiguration`;
  - options forwarded from a dependent task.

  The second review also named entries that Nx applies only to targets from a matching plugin or with a compatible executor. Nx records the plugin that inferred a target only in its source maps, and drops an entry that names another executor ([[EVD-NX-TARGET-DEFAULTS]]). The executor's context holds the merged target and `nx.json`, but not Nx's record of sources, and the options it receives no longer show which source gave them.

- **Known options.** An entry that set `features` replaced the `features` that the stand-in had inferred for `test`.
- **Conversion.** `coerceTypesInOptions` (`utils/params.js`) converts string values from the command line by the type that the schema declares for the option. This was read, not tried.

The stand-ins ran no cargo, so this shows how Nx checks, hashes and reports options for an executor of this shape, not what the plugin's executor will print. Other Nx versions were not tried.
:::

:::mara evidence EVD-NX-24-INPUT-SEMANTICS
:mid: 01M7A0X81J8XAG79EE2DFXFEZD
:title: How Nx 24.0.6 evaluates runtime inputs, selects affected tasks and hashes a cycle
:status: accepted
:supports: ADR-WORKSPACE-ROOT
:supports: ADR-TEST-MODE-CHOICE
:supports: ADR-ALL-DEP-KINDS
:supports: DES-INPUTS
:supports: RISK-NX-INPUT-SEMANTICS

Experiments on 13 November 2026 with `nx` 24.0.6, the version this repository installs, cargo and rustc 1.100.0, rustup with the toolchains 1.97.1, 1.98 and 1.100.0, Node 26.12.0 and git 2.56.0, on Linux x86-64 with bash as `/bin/sh`. The throwaway workspace lay outside this repository and had the default task-based affected. It held two Cargo workspaces: `rs`, whose `rust-toolchain.toml` selects 1.98, with the members `a`, `b` and `d`, where `b` depends on `a`, `a` has `b` as a dev-dependency and `d` depends on `b`; and `rs2`, with the member `c` and no toolchain file. A local plugin made each crate a project, with an edge for every dependency kind from `cargo metadata --no-deps`, and gave it two cached targets with the inputs of [[DES-INPUTS]]: the crate's folder as a named input and `^` over it, the workspace's `Cargo.toml` and `rust-toolchain.toml`, the runtime input `cd <workspace> && rustc -Vv`, a runtime input running a Node script that logged each evaluation with its working directory, `$0` and environment, and one `env` input. `probe` (`nx:run-commands`) logged `NX_TASK_HASH`. `test` used an executor with `batchImplementation` and `preferBatch: true` that ran `cargo test` once per Cargo workspace and logged its environment. The commands were `nx run-many -t probe --skip-nx-cache`, also with `-p` for subsets and from a crate's folder, `nx run-many -t test` with and without `--batch=false`, `nx affected -t probe --base=main --head=HEAD --explain=stdout` and `nx affected -t test --base=main --head=HEAD --skip-nx-cache` with and without `--batch=false`. Each case ran with `NX_DAEMON=false` and again with `NX_DAEMON=true`, the daemon started by `nx daemon --start` with variables that later commands did not set. Both modes gave the same results and the same hashes:

- **Evaluation.** Nx evaluated a runtime input once per task, not once per run: four tasks with the same command gave four evaluations. Every run evaluated it again, also when the daemon reused its cached project graph, and a changed output of the command, read from a file outside the workspace, changed the hashes of the next run.
- **Shell and folder.** The command ran through `sh -c` (`$0` was `sh`), in the repository root, also when `nx` was started in a crate's folder. `cd rs && rustc -Vv` worked. The hash of `a` was the same with and without `RUSTUP_TOOLCHAIN=1.98`, that of `c` was not, and `RUSTUP_TOOLCHAIN=1.97.1` changed every hash: the toolchain file of the folder the command changed into applied.
- **Environment.** The command saw the environment of the `nx` command. Variables that only the daemon's process had were not visible to it, and a `PATH` with another `rustc` in front changed the hashes under the daemon too. Nx added the dotenv files it loads for the task: a variable set in `rs/d/.env` reached the command of `d` only, one in a root `.env.test` reached the commands of `test` tasks, and a value set in the shell won over both, unless it equalled a root file's value (see the load order below). With `RUSTUP_TOOLCHAIN=1.97.1` in `rs/d/.env`, the hash of `d` differed from that of a run with the same file and `NX_LOAD_DOT_ENV_FILES=false`, and the hashes of `a` and `b` did not change; with `1.98` in that file, the two runs gave the same hash.
- **Batches.** Nx hashed each task of a batch with that task's environment, but started the batch process with the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` only (`getEnvVariablesForBatchProcess` in `tasks-runner/task-env.js`). With `NX_RUST_TEST_MODE=full` in `rs/d/.env` or in a root `.env.test`, and the variable unset in the shell, the runtime input printed `full` while the batch process had no value; with `--batch=false`, each task's process had `full`. A value in the root `.env` reached both. Root files that apply to every task still gave a mismatch: with `NX_RUST_TEST_MODE=full` in `.env.local`, `affected` in `.local.env` and nothing in the shell, every runtime input printed `full` and the batch process had `affected`. With `affected` in the shell and in `.env` and `full` in `.env.test`, the runtime inputs printed `full` and the batch process had `affected`. Without dotenv files, batched and unbatched runs restored each other's results, four of four either way.
- **Load order.** As read in the installed source (`utils/dotenv.js`, `tasks-runner/task-env.js` and `tasks-runner/task-env-paths.js`): at start, Nx loads `.local.env`, `.env.local` and `.env` from the repository root into its own environment, in that order of priority and below the shell, and the batch process inherits that environment. For a task, Nx copies that environment, unloads each variable whose value equals the one the root `.env`, `.local.env` or `.env.local` gives it, and then loads the task's files with variable expansion; the first file to set a variable wins, and no file overrides a value still present. It reads the project's folder first and then the repository root. In each, the identifiers are `<target>.<configuration>`, `<non-atomized target>.<configuration>`, `<configuration>`, `<target>` and `<non-atomized target>`, as far as they apply, each read as `.env.ID.local`, `.env.ID`, `.ID.local.env` and `.ID.env`, followed by `.env.local`, `.local.env` and `.env`. Because the unloading compares values, a shell value equal to a root file's value is removed before the task's files load, and a task file can then supply another value.
- **Affected.** `nx affected` selected tasks by changed files only. A commit changing a source file of `a` or of `b` selected `a`, `b` and `d`; one of `d` selected `d`, one of `c` selected `c`, a change of `rs/rust-toolchain.toml` selected `a`, `b` and `d`, and a new root `README.md` selected nothing. Without a changed file, a new value of the `env` input, `RUSTUP_TOOLCHAIN=1.97.1` or a new output of a runtime command selected nothing, while `nx run-many` found none of the four tasks in the cache. In each of these seven cases, `nx affected -t test` ran the same tasks batched and with `--batch=false`.
- **Cycle.** The hashes of `a`, `b` and `d` stayed the same across runs of all three together and of each alone, in either order. A change in `a` or in `b` changed all three hashes, and undoing it restored them. No run reported a task cycle.

One evaluation of `rustc -Vv` took about 6 ms on this machine, and one of the Node script about 14 ms.

These results support [[ADR-WORKSPACE-ROOT]], [[ADR-TEST-MODE-CHOICE]], [[ADR-ALL-DEP-KINDS]] and the toolchain, environment and `^` inputs of [[DES-INPUTS]]. They contradicted an assumption of [[DES-TEST-MODE]] and [[DES-BATCH]] as first written: in a batch, the executor and cargo can run with other values than the key was computed with, through a per-task dotenv file, through the different priority of `.env.local` and `.local.env`, or through an unloaded shell value. A toolchain set in one crate's `.env` also shows that the tasks of one Cargo workspace need not share a toolchain. [[RISK-NX-INPUT-SEMANTICS]] records what remains. The workspace was a toy and ran on one machine, so this says nothing about the cost of per-task evaluation in a large workspace or about macOS.
:::

:::mara evidence EVD-CARGO-NO-DEPS
:mid: 01M78RC7T7182TG80N949GFTTC
:title: What cargo metadata --no-deps reports, offline and without a lockfile
:status: accepted
:supports: ADR-METADATA-NO-DEPS

An experiment with cargo 1.99.1 on 12 November 2026. The workspace had two members, a path dependency between them, a path dependency on a crate outside the workspace, two registry dependencies, `nx` metadata tables and no `Cargo.lock`. Cargo ran with an empty Cargo home and `--offline`.

- `cargo metadata --format-version 1 --no-deps` succeeded and created no `Cargo.lock`. Adding `--locked` changed nothing.
- The full report failed in the same setting, because it could not find the registry dependencies.
- The `--no-deps` report listed the two members as packages, with their targets and crate types, and the workspace and package `metadata` tables. Each declared dependency carried its name, version requirement, kind, features and source, and a path dependency carried the absolute path of its folder. `resolve` was null. `workspace_root`, `target_directory` and `build_directory` were present.
- The crate outside the workspace was not among the packages. It appeared only as the path in its dependent's entry.
- Run in a crate that lies inside the workspace folder without being a member, the command failed with Cargo's message "current package believes it's in a workspace when it's not", which names both manifests and the remedies.

The workspace was a toy, so this says nothing about how long the call takes on a large one.
:::

:::mara evidence EVD-NX-PROJECT-MERGE
:mid: 01M7A0S43EXZZGRM5WND8Z0BBG
:title: How Nx 24.0.6 merges two plugins' projects at one root
:status: accepted
:supports: RISK-MIXED-PROJECT-MERGE
:supports: REQ-WORKSPACE-PROJECT
:supports: REQ-PROJECT-NAMES
:supports: ADR-PROJECT-NAMES
:supports: DES-PROJECT-GRAPH
:supports: REQ-INFERRED-PROJECTS
:supports: REQ-METADATA-OVERRIDES
:supports: DES-METADATA-TABLES

An experiment on 13 November 2026 with `nx` and `@nx/js` 24.0.6, TypeScript 6.0.3, pnpm 12.18.0, Node 26.12.0 and cargo 1.100.0 on Linux, together with a reading of the same `nx` package (`project-graph/utils/project-configuration-utils.js`, `project-configuration/project-nodes-manager.js` and `target-merging.js`, `plugins/package-json/create-nodes.js`).

The throwaway pnpm workspace, outside this repository, had a Cargo workspace at its root (`members = ["crates/*"]`) with three member crates: `napi-addon`, `spike-core`, and `spike-cli`, which had path dependencies on the other two. The folder of `napi-addon` also held a `package.json` named `@spike/napi-addon`, which `pnpm-workspace.yaml` listed (`crates/*` and `packages/*`), with the scripts `build`, `test` and `prepublishOnly` and with `nx.tags`. A JS package `@spike/web` in `packages/web` depended on it with `workspace:*`. The root `package.json`, named `spike-root`, had no `nx` key unless a case says so. A stand-in for this plugin, the only plugin in `nx.json` unless a case says so, ran `cargo metadata --format-version 1 --no-deps --offline` for each workspace root manifest. It returned one project per member, named after the crate, with tags, metadata and `build` and `test` targets that ran cargo; `build` set `cache`, `inputs`, `outputs` and `metadata.description`. It also returned a project named `cargo-workspace` at the workspace folder, with `fmt`, `audit` and `deny`. Its `createDependencies` returned, in this order, an edge from the workspace project to each member (`napi-addon`, `spike-cli`, `spike-core`) and then one for each path dependency (`spike-cli` to `napi-addon`, then to `spike-core`). Depending on the case, it named each end by the stand-in's own name or by the name that `context.projects` lists for the project at that root. Each case was read with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false pnpm exec nx graph --file=out/graph.json` and `nx show projects`, and one target was run with `nx run`.

- **Order.** Nx merges all projects returned for one root into one project. It merges the plugins listed in `nx.json` in their order, then target defaults, then its built-in `package.json` and `project.json` plugins, in that order. No position in `nx.json` puts a plugin after those two.
- **Name.** A later layer replaces the name. A folder whose `package.json` Nx reads takes its name from that file (`nx.name`, or else `name`), and a `project.json` that sets a name overrides both, whatever the order in `nx.json`. A `project.json` without a name kept the earlier name. Of two plugins listed in `nx.json`, the later one's name won. Nx reads a `package.json` only when the package manager's workspaces list it or a `project.json` sits beside it, and the root `package.json` also when it has an `nx` key. A crate's `package.json` outside the workspaces left the crate's project, name and targets unchanged.
- **Targets.** Targets with different names were all kept. By `isCompatibleTarget` in `target-merging.js`, two targets with one name are merged when either of them names no executor, or when both name the same executor and, for `nx:run-commands` and `nx:run-script`, the same command or script, or one of them none. A merge keeps the earlier target's settings and lets each setting of the later one replace its counterpart: a `project.json` target `build` with `executor: "nx:run-commands"` and only `inputs`, or with `inputs` and no executor, kept the cargo command, `cache`, `outputs` and metadata and replaced the list of inputs. Any other target of the same name replaces the earlier one, with its `cache`, `inputs` and `outputs`. Only the earlier target's metadata can remain, merged under the later target's when the later one has metadata of its own: a `project.json` `build` with another command and no metadata left nothing of the cargo target. A `package.json` script is a target with the executor `nx:run-script` and with metadata, so the scripts `build` and `test` replaced the cargo targets while the stand-in's `description` stayed in their metadata, and `nx run` of the merged project's `build` ran the script. Between `@nx/js/typescript` and the stand-in, the plugin listed later in `nx.json` won `build`, and the TypeScript `build` came with its own `dependsOn: ["^build"]`.
- **Tags, implicit dependencies and metadata.** The tags of all layers were united and their implicit dependencies combined. Metadata was merged key by key: objects such as `targetGroups` were combined, lists under one key concatenated, and a plain value such as `description` replaced by the later layer's.
- **Edges.** In `createDependencies`, `context.projects` is keyed by the merged names, and each entry carries its root. Nx adds a plugin's edges one at a time, in the order returned. An edge whose target was the crate name of a project that `package.json` had renamed was dropped without a message, and the edges around it were kept. An edge whose source was such a name failed graph creation with "Source project does not exist". Nx added none of the edges after it, while those before it stayed in its partial graph. When the root `package.json` renamed the workspace project, the invalid source came first and no edge of the stand-in was kept. With an edge from `napi-addon` to `spike-core` inserted after the three edges from the workspace project, those three were kept and the two after it were not. Edges whose ends were looked up by root were all present. A `dependsOn` entry that named the crate was rewritten to the merged name, and the JS package's `workspace:*` dependency became an edge to the merged project.
- **Workspace project at the root.** Without a root `project.json` and without an `nx` key in the root `package.json`, the workspace project stood alone under the stand-in's name. With either, it merged into the root project and took that file's name. The root scripts `audit` and `lint` and a `project.json` target `fmt` replaced or joined the workspace targets by the rules above, and the merged project depended on every member.
- **Collisions.** A crate and a JS package with one name in different folders made Nx fail with its own message, "The following projects are defined in multiple locations", which lists both folders and recommends a `project.json`. A lookup by root in `context.projects` finds only one of two projects that share a name. When the stand-in returned an edge with the missing end undefined, Nx failed with "Cannot read properties of undefined (reading '1')" instead.

For a crate folder that also is a JS project, no plugin listed in `nx.json` can set the project's name. [[REQ-PROJECT-NAMES]], [[ADR-PROJECT-NAMES]] and [[DES-PROJECT-GRAPH]] therefore name such a project by its `package.json` or `project.json`; until 13 November 2026 they named every project after its crate or its `name` override. For the review of 13 November 2026, the following were re-run in the same workspace, with `outputs` added to the stand-in's `build`: the target merges and replacements, both edge orders, the dropped edges, the `dependsOn` rewrite, the names given by `nx.name` with and without a named `project.json`, and the TypeScript `build`. The other outcomes are from the first run. The stand-in modelled the planned plugin; the plugin itself and other Nx versions were not tested.
:::

:::mara evidence EVD-WORKSPACE-PROJECT-NAMES
:mid: 01M7A8AKF5NT40CMP6236AFA2V
:title: How Cargo 1.100.0 and Nx 24.0.6 treat names for a workspace project
:status: accepted
:supports: ADR-WORKSPACE-PROJECT-NAME
:supports: REQ-PROJECT-NAMES
:supports: DES-PROJECT-GRAPH
:supports: DES-METADATA-TABLES

Experiments on 13 November 2026 with cargo 1.100.0, `nx` 24.0.6 and Node 26.12.0 on Linux, in throwaway folders outside this repository, together with a reading of the same `nx` package. The Nx workspaces linked the `node_modules` of this repository, had a root `package.json` and listed one stand-in plugin in `nx.json`. Its `createNodesV2` matched `**/name.txt` and returned a project at that file's folder, named by the file's content, with targets `fmt` and `audit` that echo the folder. Commands ran with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false NX_NO_CLOUD=true NX_TUI=false`, and runs with `--output-style=static --skip-nx-cache`.

- **Cargo has no workspace name.** In a virtual manifest, `name` under `[workspace.package]` made `cargo check --offline` warn `unused manifest key: workspace.package.name`. `cargo metadata --no-deps --offline --format-version 1` reported `workspace_root` as an absolute path, and `[workspace.metadata.nx]` with its nested `project` table (`name`, `tags`, `targets.sqlx-prepare.command`) unchanged under the report's top-level `metadata`. For a root manifest with both `[package]` and `[workspace]`, the report carried `[package.metadata.nx]` on that package and `[workspace.metadata.nx.project]` at the top level.
- **Cargo package names.** `cargo metadata` on a one-package manifest rejected the names `a.b`, `a:b`, `a/b`, `a+b`, `a b` and `a~b` ("characters must be Unicode XID characters (numbers, `-`, `_`, or most letters)"), `@a` (not a Unicode XID start character) and `1abc` (starts with a digit), and accepted `abc`, `a_b`, `a-b`, `Rust-WS` and `ü-crate`.
- **Nx accepts any name.** The stand-in created projects named `rust`, `a.b`, `@ws/rust`, `a:b`, `a b`, `Rust-WS`, `rust+ws`, `ws/rust`, `cargo:ws`, `ü-rust`, `a,b`, `!bang`, `x*y`, `tag:foo`, `a#b`, `rust/` and `.dot`. `nx show projects` listed all of them, and for each one `nx run <name>:fmt`, `nx fmt <name>` and `nx show project <name> --json` reached that project. Nx checks only that a name is present and unique (`validateProject` in `project-graph/utils/project-configuration/target-normalization.js`).
- **Patterns.** `nx run-many -t fmt -p <name>` ran exactly that project for each name except two: `-p 'a,b'` split into `a` and `b` and ran five projects, and `-p '!bang'` excluded that project and ran every other one. A pattern without glob characters that is not exactly a project name matches the names that contain it as a whole word, ignoring case and counting `-` and `@` as part of a word, and only when no name matches, a project folder: `-p Rust` ran `rust`, `@ws/rust`, `rust+ws`, `ws/rust` and `rust/` (`utils/find-matching-projects.js`). With a `:` in a name, `nx run` tries every split of the string against the graph and warns when more than one fits (`utils/split-target.js`); `nx run a:b:fmt` and `nx run cargo:ws:fmt`, which no other project made ambiguous, ran.
- **Folders.** A project named `rust-workspace` in `rustdir/` was reached by `nx fmt rustdir`, `nx run rustdir:fmt`, `nx show project rustdir --json`, `-p rustdir` and `-p directory:rustdir`, and one named `services-billing` in `services/billing/` by `nx fmt services/billing` and `nx run services/billing:fmt`; `nx fmt ./rustdir` failed with "Cannot find project". When a name is not found, `nx run`, `nx <target> <project>` and `nx show project` fall back to the same pattern matching and accept a single match (`command-line/run/run-one.js`, `command-line/show/project.js`). Inside `rustdir/`, a bare `nx fmt` ran that project (`config/calculate-default-project-name.js`).
- **Root.** In a second workspace with the stand-in's project `cargo-workspace` at the root, a project `sub-crate` in `sub/` and a root `package.json` named `exp-root-pkg`, `nx fmt` from the root, `nx fmt .`, `-p .` and `-p directory:.` each ran the root project. `nx show project . --json` named the root project `cargo-workspace` without a root `project.json` and without an `nx` key; `exp-root-pkg` with `"nx": {}` in the `package.json`, and also with a root `project.json` of `{}`; and `repo` with a root `project.json` that sets that name. In each of these cases the project kept `fmt` and `audit`. With a `project.json` of `{}` and a root `package.json` without a name, graph creation failed.
- **Default names.** For the review, a second stand-in matched `**/ws.txt` and named its project by the agreed rule: the path from the root with each `/` replaced by `-`, `cargo-workspace` at the root, or the file's content when it had any. Projects in `services/billing/` and `services-billing/` both got `services-billing`, and projects at the root and in `cargo-workspace/` both got `cargo-workspace`. In both cases Nx failed with "The following projects are defined in multiple locations", listing the two folders.
- **When Nx reads a `package.json`.** With that stand-in and the name `billing-override` set for `services/billing/`, the project kept `billing-override` after a `project.json` of `{}` was added to that folder with no `package.json` beside it, and took `@acme/billing` once a `package.json` of that name was added beside the `project.json`. Without the `project.json`, that `package.json` left `billing-override` in place, with or without an `nx` key, until the root `package.json` listed `services/*` under `workspaces`. At the root, `cargo-workspace` gave way to the root `package.json` name when the workspace patterns included `.`, through `"workspaces": ["."]` in that file or `packages: ["."]` in `pnpm-workspace.yaml`, and stayed when `pnpm-workspace.yaml` listed only `packages/*`. Nx therefore reads a `package.json` when the package manager's workspace patterns include it or when a `project.json` sits beside it, and the root `package.json` also when it has an `nx` key; a nested `package.json` with only an `nx` key is not read (`plugins/package-json/create-nodes.js`).
- **Nx's default.** For a `project.json` without a name, Nx uses the last segment of its folder in lower case, and `.` at the root (`config/to-project-name.js`); read, not run.
- **Checkouts.** The checkout of this repository in which the work was done is a folder named `t3-978a6461-ca0fb10813ae42be`, not `nx-rust`.

How often a workspace folder has the name of one of its own crates was not measured, and macOS was not tested.
:::

:::mara evidence EVD-NX-FORMAT
:mid: 01M78JWQAZK1MDJ6GC4M70ZCXX
:title: nx format cannot run rustfmt in Nx 24.0.6
:status: accepted
:supports: ADR-NX-TARGET-NAMES

Inspection of the `nx` 24.0.6 package installed in this repository, and two experiments, on 12 November 2026:

- **A command, not a target.** `nx format:check` and `nx format:write` (alias `nx format`) are built-in commands. They run the workspace's one formatter over changed files, over `--projects` or over `--all`, and they run no targets (`command-line/format/format.js`).
- **Two formatters, no hook.** The formatter is oxfmt or prettier, detected from configuration files or from the dependencies in the root `package.json`, oxfmt first. Any other formatter is an error; there is no plugin hook (`utils/formatters/`).
- **A reserved name.** `format` is in the list of known commands that Nx checks before it treats the first argument as a target (`bin/init-local.js`). `nx format <project>` therefore runs the built-in command, never a target named `format`.
- **prettier.** Before Nx calls prettier it keeps only the files whose extension or name is in `prettier.getSupportInfo()`, called without plugins. With prettier 3.10.1 that call does not list `.rs`; it does when a plugin that declares `.rs` is passed explicitly. A prototype prettier plugin that pipes a file through `rustfmt --emit stdout` (rustfmt 1.10.0) formatted and checked `.rs` files through the plain `prettier` CLI. So a rustfmt plugin for prettier is feasible, but `nx format` drops `.rs` files before prettier sees them.
- **oxfmt.** Given a `.rs` file and a `Cargo.toml`, oxfmt 0.78.0 ignored the `.rs` file and reported the `Cargo.toml` as unformatted. Its configuration schema has no setting for plugins or external formatters. In a workspace that uses oxfmt, `nx format:write` therefore reformats `Cargo.toml` files and leaves Rust sources alone.

The prototype was not run through `nx format` itself; that Nx filters `.rs` out is read from its source, and that the filter excludes plugin languages was tested against prettier directly. Covering Rust in `nx format` would need Nx to pass the configured plugins to its filter, and would still not reach workspaces that use oxfmt.
:::

:::mara evidence EVD-CARGO-NEW
:mid: 01M7A66QH6W8544G03RW7GAX0G
:title: What cargo new does inside a repository and a workspace
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Experiments with cargo 1.100.0 (3acc79c0c 2026-11-05) on Linux, on 13 November 2026, in throwaway git repositories (`git init`, no commit) outside this repository. No folder pinned a toolchain.

- **A git repository inside the crate.** In a repository where `rust/` existed and `rust/crates/` did not, `cargo new rust/crates/core` created `.git` and a `.gitignore` inside the new crate. Where the parent folder existed, `cargo new direct` created neither. `cargo new --vcs none newparent2/a/b`, with no folder of that path present, created neither.
- **Members.** In a workspace with `members = ["crates/*"]`, `cargo new --lib rust/crates/core` left the workspace manifest unchanged. `cargo new --bin rust/tools/cli` printed "Adding `cli` as member of workspace at …" and appended `"tools/cli"` to `members`, keeping the existing entry. In a workspace without a `members` key, `cargo new --vcs none --lib ws-nomembers/crates/a` added `members = ["crates/a"]`. With a workspace inside another workspace's folder, the crate was added to the nearer workspace only.
- **Exclude.** Cargo reads an `exclude` entry as a path relative to the workspace root, not as a glob. In a workspace with `members = ["crates/*"]` and `exclude = ["vendor/*", "legacy"]`, `vendor/*` excluded nothing: `cargo metadata --no-deps --format-version 1` in a package at `vendor/v` that `members` did not list failed with "current package believes it's in a workspace when it's not". The path entry `legacy` did exclude: `cargo new --vcs none --lib legacy/old` still printed "Adding `old` as member of workspace", appended `"legacy/old"` to `members` and left `exclude` as it was. `cargo metadata` in `legacy/old` then reported the workspace root, so the explicit member overrode `exclude`. With `"legacy/old"` removed from `members`, it reported `legacy/old` as its own workspace root. Cargo 1.91.0 and 1.100.0 behaved the same, in a run on 13 November 2026 that the reviewer of nxr-eg9s2w repeated.
- **Inheritance.** In a workspace whose `[workspace.package]` set `edition = "2021"` and `license = "MIT"` and which had `[workspace.lints.rust]`, the new manifest had `edition.workspace = true`, `license.workspace = true` and `[lints] workspace = true`. With `--edition 2024`, it had `edition = "2024"` and still `license.workspace = true`.
- **Name.** `cargo new --vcs none --bin --name my-tool rust/crates/tool-dir` created the package `my-tool` in the folder `tool-dir`. Without `--name`, the package took the folder's name; for `core`, cargo warned that the name may be confused with the standard library's package.
- **Outside a workspace.** `cargo new --vcs none --lib standalone-parent/s` wrote `edition = "2024"` and changed no other manifest. Inside the folder of a valid package without a `[workspace]` table, the new crate was its own workspace root, according to `cargo metadata`. When the enclosing package's manifest was invalid, cargo still created the crate and warned that compiling it may not work.
- **An existing folder.** `cargo new --vcs none --lib rust/crates/ed`, run a second time, failed with "destination `…` already exists" and exit status 101, and changed nothing.
- **Options.** `cargo new --help` lists `--vcs` (`git`, `hg`, `pijul`, `fossil`, `none`), `--bin` (the default), `--lib`, `--edition` (2015, 2018, 2021, 2024), `--name` and `--registry`.

Apart from the exclude bullet, only one Cargo version was tried, on Linux. The messages observed carried no error codes.
:::

:::mara evidence EVD-CARGO-DIRECTORIES
:mid: 01M7A6739R6CSCWVAQ2JJWDHF2
:title: Where Cargo puts its two directories, and which versions report them
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Experiments on Linux on 13 November 2026, in throwaway folders outside this repository, with `cargo metadata --no-deps --format-version 1`. No folder pinned a toolchain, and the older toolchains were already installed and selected with `cargo +<version>` under `RUSTUP_AUTO_INSTALL=0`.

- **Default.** Without configuration, cargo 1.100.0 reported `build_directory` and `target_directory` both as `<workspace>/target`, inside the workspace folder. For a crate that is its own workspace, that is a folder inside the crate.
- **Template.** With `[build] build-dir = "{cargo-cache-home}/build/{workspace-path-hash}"` in a `.cargo/config.toml` above the workspace, cargo 1.100.0 reported a `build_directory` below the Cargo home (`~/.cargo/build/21/d5123ee45e798c`) and the same `target_directory` as before.
- **Versions.** For a one-crate package, the report of cargo 1.89 had no `build_directory` key, and the reports of cargo 1.97.1 and 1.100.0 had it. The other top-level keys were the same in all three: `metadata`, `packages`, `resolve`, `target_directory`, `version`, `workspace_default_members`, `workspace_members` and `workspace_root`.

Cargo's source settles where the field begins. It was added to `cargo metadata` by rust-lang/cargo pull request #15377, merged on 2 April 2025, while `build.build-dir` was unstable. In the Cargo that Rust 1.90.0 ships (rust-lang/cargo commit 840b83a, package version 0.91.0), `src/cargo/ops/cargo_output_metadata.rs` writes `build_directory` only when the unstable `-Zbuild-dir` flag is on, and leaves the key out otherwise; unstable flags work only on nightly. In the Cargo that Rust 1.91.0 ships (commit ea2d978, package version 0.92.0), it always writes the field, and Cargo's changelog lists the stabilisation of `build.build-dir` under 1.91. The report of a stable Cargo therefore has `build_directory` from 1.91 on. The source was read through GitHub, at the cargo commits that the `src/tools/cargo` submodule of rust-lang/rust names at the tags `1.90.0` and `1.91.0`. Cargo 1.90 and 1.91 were not run here, because no toolchain was downloaded.
:::

:::mara evidence EVD-RUSTUP-MISSING-TOOLCHAIN
:mid: 01M7AN00P9TZ5VQQT8SSXTHC4V
:title: What rustup 1.29.3 and Nx 24.0.6 do when a pinned toolchain is missing
:status: accepted
:supports: DES-METADATA-REPORT
:supports: RISK-NX-INPUT-SEMANTICS
:supports: ADR-GRAPH-NO-TOOLCHAIN-INSTALL
:supports: DES-INPUTS

Experiments on 13 November 2026 on Linux x86-64 with rustup 1.29.3, whose proxies came first on `PATH`, and with `nx` 24.0.6, in throwaway folders outside this repository. A folder's `rust-toolchain.toml` named the toolchain `1.92.0`, which was not installed. Every command that could reach rustup ran with `RUSTUP_AUTO_INSTALL=0`, and rustup listed the same toolchains afterwards.

- **rustup's default.** Earlier that day, while the test fixtures were built and with the variable unset, a plain `rustup show active-toolchain` in a folder whose toolchain file named `1.91.0`, missing then, downloaded and installed that toolchain without asking. That case was not run again.
- **Missing toolchain.** In the pinned folder, `cargo metadata --no-deps --format-version 1` and `rustc -Vv` each wrote nothing to standard output, wrote `error: toolchain '1.92.0-x86_64-unknown-linux-gnu' is not installed` and ``help: run `rustup toolchain install` to install it`` to standard error, and exited with status 1. So did `sh -c 'cd pinned && RUSTUP_AUTO_INSTALL=0 rustc -Vv'`, the form a runtime input takes, started in the parent folder with the variable unset.
- **Folder.** In a workspace whose root pinned nothing, a member and a path dependency outside the workspace each pinned `1.92.0` in their own folder. `cargo metadata` started in the root folder succeeded, for the workspace and with `--manifest-path` naming the path dependency, while the same calls started in the member's and in the dependency's folder failed as above. The folder a command starts in decides which toolchain file applies, not the manifest it reads.
- **Without rustup.** With the cargo and rustc 1.99.1 of the Arch Linux `rust` package first on `PATH`, which are no rustup proxies, both commands succeeded in the pinned folder with the variable set: cargo reported the package, and `rustc -Vv` reported 1.99.1. Such a toolchain ignores the toolchain file and the variable.
- **Nx.** In a workspace whose cached `nx:run-commands` target had the runtime input `cd ../pinned && RUSTUP_AUTO_INSTALL=0 rustc -Vv` as its only input, `nx run` with the daemon off ran the task, succeeded and printed nothing about the failed command, and a second run restored the task from the cache. With `1.93.0`, also missing, pinned instead, the key changed. With runtime commands such as `echo A >&2; exit 1`, the key followed what the command wrote to standard error, and neither its exit status nor its text: `exit 1`, `exit 2` and `exit 0` after the same `echo A >&2` gave one key, and so did `exit 3` and `exit 4` without output.
- **A value per evaluation.** With the runtime input `cd ../pinned && RUSTUP_AUTO_INSTALL=0 rustc -Vv 2>/dev/null || od -An -N16 -tx1 /dev/urandom`, three runs of the task gave three different task hashes, each a cache miss. Pointed at a folder that pinned nothing, the same command gave the hash that plain `rustc -Vv` gave there, and the next two runs restored the task from the cache.

So `RUSTUP_AUTO_INSTALL=0` turns rustup's download of a pinned toolchain into a failure whose message names the toolchain, and it changes nothing where cargo is no rustup proxy. Nx 24.0.6 does not fail a task whose runtime input fails: it keys the task on the command's output and runs the task. Keyed on rustup's message, the task would name the toolchain only as the toolchain file does, for a channel such as `stable` not the release that cargo would install. A random value printed in its place, with rustup's message discarded, gives each evaluation a key of its own and leaves the key of an installed toolchain as it was.
:::

:::mara evidence EVD-NX-24-SETUP
:mid: 01M7A67N99XVQ7ZV6NVRJB0W8N
:title: How Nx 24.0.6 adds a plugin, runs generators and shows plugin output
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Inspection of the `nx`, `@nx/devkit` and `@nx/js` 24.0.6 packages installed in this repository, and experiments with that `nx` package, on 13 November 2026. Paths are relative to `nx/dist/src/` unless another package is named.

Read in the compiled source:

- **`nx add`.** For a package outside Nx's own package group, `nx add <package>` installs `latest` unless a version is given, then runs `nx g <package>:init` with the terminal attached, adding `--keepExistingVersions` or `--updatePackageScripts` only when the init schema declares them. When `init` fails, the command exits with status 1 and the package stays installed (`command-line/add/add.js`, `command-line/init/configure-plugins.js`).
- **The graph comes first.** `nx g` creates the project graph, with every registered plugin, before it runs any generator, unless `--skipProjectGraph` is given (`command-line/generate/generate.js`).
- **Dry run.** Nx lists a generator's changes to its file tree after the generator returns, and writes them and runs the callback the generator returns only without `--dry-run` (`generate.js`). It takes `dryRun` out of the options it hands the generator and sets `NX_DRY_RUN` to `true` or `false` for the run (`generate.js`, `command-line/generate/command-object.js`).
- **Prompts.** Prompts for options appear only when standard output is a terminal and `CI` is not `true` (`utils/params.js`).
- **Directory.** The devkit helper for project names and roots resolves a generator's `directory` against the folder `nx` runs in, unless the path already starts with that folder (`@nx/devkit`, `generators/project-name-and-root-utils.js`). `@nx/js:library` requires `directory`, takes it from the first positional argument, and has an optional `name` (`@nx/js`, `generators/library/schema.json`).
- **Plugin output.** Plugin workers run with their standard output and error piped into the process that started them (`project-graph/plugins/isolation/isolated-plugin.js`), and the daemon's standard output and error go to its log file (`daemon/client/client.js`). The plugin interface has no channel for warnings (`project-graph/plugins/public-api.d.ts`).
- **Environment.** A client's first message carries its environment to the daemon, which applies it, forwards it to the plugin workers and recomputes a graph that was created under other values (`daemon/client/client.js`, `daemon/server/handle-client-env.js`).
- **Ignored paths.** Besides what `.gitignore` and `.nxignore` exclude, Nx always ignores only `**/node_modules`, `**/.git`, `**/.nx/cache`, `**/.nx/workspace-data` and `**/.yarn/cache`, as printed by calling `getHardcodedIgnorePatterns()` from `nx/src/native`.
- **Codes.** A search of `nx/dist/src` found no numbered codes for user-facing diagnostics, such as `NX` followed by digits.
- **TOML.** `nx` depends on `smol-toml`; `@nx/devkit` has no TOML dependency.

Observed in a throwaway git repository outside this one, with that `nx` package linked into its `node_modules`, Node.js 26.12.0, one `Cargo.toml` and a local plugin file listed in `nx.json` whose `createNodes` printed a line with `console.warn`, including the value of an environment variable:

- With `NX_DAEMON=false`, `nx show projects` printed the line in the terminal.
- With `NX_DAEMON=true`, the terminal showed only the project list, and the line appeared in `.nx/workspace-data/d/daemon.log`. A second run with the same environment did not run the plugin again. A run with the variable changed made the daemon log "Graph recompute necessary due to env variable refresh. Changed keys: …", and the plugin printed the new value there.
- A second local plugin whose module threw when loaded made `nx run js-app:build`, the `package.json` script of a JS project, fail with "Failed to load 1 Nx plugin(s)" and the thrown message, exit status 1. `nx show projects` and `nx g <package>:init` failed the same way. `nx --version` still worked, and so did `nx g <package>:init --skipProjectGraph`, which ran the generator.
- A `crate/target` folder that neither `.gitignore` nor `.nxignore` covered was part of the crate's project: Nx's file map listed `crate/target/junk.rs` among the project's files, and the plugin was handed a `Cargo.toml` from `crate/target/package/`. With `target/` in `.nxignore` alone, neither happened. Neither did it for `crate/.nx/cache/target` and `crate/node_modules/target`, which `git check-ignore` confirmed neither ignore file covered, with `.gitignore` holding only `/.nx` and no `.nxignore`: Nx's fixed exclusions kept the files of both out of the file map, and the plugin was not handed the `Cargo.toml` under `crate/.nx/cache/target/package/`.

Observed with pnpm 12.18.0 in a second throwaway repository, whose `package.json` linked that `nx` package, and a local package whose `init` generator threw: `nx add probe-plugin@file:<folder>` added the package to `package.json` and `pnpm-lock.yaml` and installed it, then failed with the generator's message and exit status 1. The package stayed in `package.json` and `node_modules`, and `nx.json` was unchanged.
:::

:::mara evidence EVD-NX-24-VERSION-CHECK
:mid: 01M7AR5NQ71CB4YNT6NRTYWHJZ
:title: How Nx 24.0.6 and pnpm 12.18.0 treat a plugin that checks the Nx version
:status: accepted
:supports: DES-DIAGNOSTICS
:supports: DES-GENERATORS

Inspection of the `nx` 24.0.6 package installed in this repository, and experiments with it and with pnpm 12.18.0, on 13 November 2026, while implementing the version checks of [[DES-DIAGNOSTICS]]. Paths are relative to `nx/dist/src/`.

Read in the compiled source:

- **The installed Nx.** Nx takes the version of the installed Nx from the `nx/package.json` that resolves from `.nx/installation` and then from the repository root (`utils/installed-nx-version.js`, `utils/installation-directory.js`), and finds the repository root from the folder it runs in, or from `NX_WORKSPACE_ROOT_PATH` (`utils/workspace-root.js`). When that version differs from the version of the Nx that runs, the client does not use the daemon (`daemon/client/client.js`, `daemon/is-nx-version-mismatch.js`).
- **Hooks without files.** Graph creation calls each plugin entry's `createNodes`, also when none of the repository's files matches the entry's pattern, `include` and `exclude`: it then hands the entry an empty list (`project-graph/utils/project-configuration-utils.js`).
- **Reloads.** A plugin in a worker, the default, whose last hook is `createDependencies` has its worker shut down after that hook, and the next hook call starts a new worker that loads the module again (`project-graph/plugins/isolation/isolated-plugin.js`, `plugin-lifecycle-manager.js`). A plugin loaded into Nx's own process, with `NX_ISOLATE_PLUGINS=false`, stays loaded. When a client's environment changes, the daemon forwards it to the workers and discards its graph, but it loads no plugin again (`daemon/server/handle-client-env.js`). A failed load is not kept: the next graph creation loads the plugin again (`project-graph/plugins/get-plugins.js`, `isolation/load-isolated-plugin.js`).
- **Errors of `createDependencies`.** When `createNodes` fails, graph creation still calls `createDependencies` with the projects it has, and then reports the errors of both, an error of `createDependencies` as `The "<plugin>" plugin threw an error while creating dependencies: <message>` (`project-graph/project-graph.js`, `project-graph/build-project-graph.js`, `project-graph/error-types.js`). Graph creation merges the projects of the plugins of `nx.json` with those of Nx's default plugins for `package.json` and `project.json` before it calls `createDependencies` with them by name.
- **Internals.** The `exports` of `nx/package.json` include `./src/*`, so `nx/src/project-graph/plugins/get-plugins` and `nx/src/project-graph/utils/retrieve-workspace-files`, which load the plugins of `nx.json` and read the files of the repository by project, can be required alongside `nx/src/devkit-internals`.

Observed in a throwaway git repository outside this one, with one `Cargo.toml` and a local plugin file in `nx.json` that printed a line when it loaded and when its hooks ran, and could throw from either, run with a copy of that `nx` package whose `package.json` gave the version 25.0.0, linked as the repository's `node_modules/nx`:

- `nx --version` reported the local Nx as 25.0.0, and the copy created the graph, with the plugin in a worker and in Nx's own process.
- A throw when the module loaded made `nx show projects` fail with "Failed to load 1 Nx plugin(s)" and the message.
- With `NX_DAEMON=true`, the daemon log showed Nx 25.0.0. Changing a variable between runs made the daemon log "Graph recompute necessary due to env variable refresh", restart the plugin's worker and load the module again with the new value. A throw from `createNodes` failed the run, the next run with another value succeeded, and the run after that with the first value failed again. A throw when the restarted worker loaded the module failed both hooks, so the message appeared twice, once for `createNodes` and once for `createDependencies`.

Observed with pnpm 12.18.0 in a second throwaway repository that installed `nx` 24.0.6 from pnpm's store: adding a local package whose peer dependency range on `nx` was `^23` printed "Issues with peer dependencies found" and exited with status 0, with the package installed. `pnpm peers check` then listed the unmet peer with the installed and wanted versions and exited with status 1. pnpm linked the repository's `nx` into the package's folder in its store, so that `nx` resolves from the package. With the range `^24`, neither printed anything about peers.

So a plugin that checks the version only when its module loads misses a change of `NX_RUST_ALLOW_UNSUPPORTED_NX` while a daemon runs it in Nx's own process, and a check in `createNodes` runs on every graph computation, also in a repository without a `Cargo.toml`. The peer dependency range does not stop an install with another Nx major; only the plugin's own check stops it.
:::

:::mara evidence EVD-CARGO-TARGET-COMMANDS
:mid: 01M7A4FCEFVN0W56WPDHWWW88N
:title: What cargo, rustfmt and rust-analyzer 1.100 do with the commands of the inferred targets
:status: accepted
:supports: DES-TARGET-COMMANDS
:supports: DES-WORKSPACE-TARGETS
:supports: ADR-NX-TARGET-NAMES
:supports: DES-INPUTS
:supports: DES-INVOCATION
:supports: DES-BATCH

Experiments on 13 November 2026 with cargo 1.100.0 (3acc79c0c 2026-11-05), rustc 1.100.0, clippy 0.1.100, rustfmt 1.11.0 and rust-analyzer 1.100.0, all from one rustup toolchain, in a throwaway virtual workspace outside this repository. Its members were `a`, a library with a `harness = false` bench and a deliberate unused variable, and `b`, a crate with two binaries, `b` and `second`, that depends on `a`. `a` also depended on `ext`, a path dependency outside the workspace. For one check cargo 1.89.0, 1.91.0, 1.96.0, 1.97.0, 1.97.1 and 1.98.1 were used as well, each with a target directory of its own; 1.91.0, 1.96.0 and 1.97.0 were installed with the minimal profile into a rustup home of their own.

- **check and clippy.** `cargo check --all-targets -p a` checked `ext` and `a`. A following `cargo clippy --all-targets -p a` checked `a` again and reused `ext`. Alternating `cargo clippy --all-targets -p a` with `cargo clippy --all-targets -p a -- -D warnings` checked `a` again on every switch, and the run with `-D warnings` failed on the warning.
- **build.warnings.** `CARGO_BUILD_WARNINGS=deny cargo clippy --all-targets -p a` failed with "warnings are denied by `build.warnings` configuration", and a plain `cargo clippy --all-targets -p a` afterwards checked nothing again. `CARGO_BUILD_WARNINGS=deny cargo check -p a` failed in the same way with cargo 1.97.0, 1.97.1, 1.98.1 and 1.100.0, and with cargo 1.89.0, 1.91.0 and 1.96.0 it succeeded with the warning and no notice about the setting. Cargo's configuration reference (doc.rust-lang.org/cargo/reference/config.html, read the same day) gives the same boundary for `build.warnings`: "MSRV: Respected as of 1.97". With cargo 1.100.0 and `CARGO_BUILD_WARNINGS=deny`, `cargo run -p b --bin second` and `cargo bench -p a` failed the same way on the warning in `a`, since both compile it.
- **rust-analyzer.** `rust-analyzer --print-config-schema` gives `cargo.allTargets` the default `true`, `check.allTargets` the default of `cargo.allTargets`, `check.workspace` the default `true` and `check.command` the default `"check"`. The editor's check is therefore `cargo check --workspace --all-targets`.
- **Nightly benches.** With a bench in `b` that uses `#![feature(test)]`, `cargo check --all-targets -p b` failed on stable with E0554, while `cargo check -p b` passed. So did `cargo check -p a -p b`, while `cargo check --all-targets -p a -p b` failed with E0554: one call cannot check `a` with `--all-targets` and `b` without.
- **fmt.** `cargo fmt --check --all` reported files of `ext` as well as of the members, and `cargo fmt --all` rewrote `ext`'s source. `cargo fmt --check` without flags, run in the workspace root, reported exactly the members' files, both in this virtual workspace and in a second one whose root manifest is a package with one more member. `cargo fmt --check -p a -p b` checked both crates. A package ID spec after `-p` was rejected as "not a member of the workspace", while `--manifest-path crates/a/Cargo.toml` selected `a`. `cargo fmt --check` exited with 1 when a file needed formatting. `cargo fmt --locked -p a`, `cargo fmt --check --locked -p a` and `cargo fmt -p a --locked` failed with exit code 2 and "unexpected argument '--locked' found"; `cargo fmt --help` lists no `--locked`, `--offline` or `--frozen`.
- **doc.** `cargo doc --no-deps -p a` and then `cargo doc --no-deps -p b` wrote `doc/a`, `doc/b` and `doc/second`, one folder per documented library or binary, and `doc/src/a`, `doc/src/b` and `doc/src/second`, beside files that both runs shared: `crates.js`, `search.index`, `src-files.js`, `static.files`, `help.html` and `settings.html`. `crates.js` listed `a` after the first run and `a`, `b` and `second` after the second. `doc/a/index.html` loads its styles from `../static.files/`. `cargo doc --no-deps --workspace` documented both members in one run.
- **run.** `cargo run -p b` failed with "`cargo run` could not determine which binary to run" and listed `b, second`; `cargo run -p b --bin second -- x` ran `second`. `cargo run -p a -p b` failed because `--package` cannot be given more than once.
- **bench.** `cargo bench -p a` ran on stable: the library's test harness in bench mode and then the `harness = false` bench.
- **update.** After a new path dependency was added to a manifest, `cargo update --locked` failed with "cannot update the lock file … because --locked was passed to prevent this", and `cargo update` then updated `Cargo.lock`. Without such a change, `cargo update --locked` succeeded.

The workspace was a toy, so nothing here says how long these commands take on a large one.
:::

:::mara evidence EVD-CARGO-AUDIT-DENY
:mid: 01M7A4FCEFMBYHR6YR0ZANHNS3
:title: What cargo-audit 0.23.0 and cargo-deny 0.20.2 read, fetch and write
:status: accepted
:supports: DES-WORKSPACE-TARGETS
:supports: DES-INVOCATION

Experiments on 13 November 2026 with cargo-deny 0.20.2 and cargo-audit 0.23.0, installed with `cargo install --locked` into a throwaway folder, and cargo 1.100.0, with a Cargo home of their own that started empty. The workspace, outside this repository, had one member `x` with `license = "MIT"` that depended on the registry crate `itoa`, whose license is `MIT OR Apache-2.0`. Every command ran in the workspace root.

- **No configuration.** Without a configuration file, `cargo deny check` warned "unable to find a config path, falling back to default config", rejected the licenses of `itoa` and `x`, and exited with code 4; advisories, bans and sources passed. A configuration that allows MIT and Apache-2.0 made the license check pass when it was `deny.toml`, `.deny.toml` or `.cargo/deny.toml` in the workspace root. `cargo deny --help` says the configuration defaults to `deny.toml` in the current folder.
- **Network.** Both tools fetched the RustSec advisory database into the Cargo home: cargo-audit printed "Fetching advisory database from `https://github.com/RustSec/advisory-db.git`" and loaded 1490 advisories. cargo-audit also updated the crates.io index.
- **Lockfile.** After a dependency was added to the member's manifest, `cargo deny check` updated `Cargo.lock`. `cargo deny --locked check` failed instead with Cargo's "cannot update the lock file … because --locked was passed to prevent this" and left the file unchanged. `cargo audit` scanned the old `Cargo.lock`, which did not list the new dependency, and left it unchanged. Its options include `--no-fetch` and `--stale`, and none like `--locked`.
- **cargo-audit configuration.** An invalid `.cargo/audit.toml` in the workspace root made `cargo audit --no-fetch` fail with a TOML parse error. The same file as `audit.toml` in the workspace root, or as `.cargo/audit.toml` in the member's folder, was ignored.

What these tools report thus depends on the advisory database at the time they run, not only on files in the repository.
:::

:::mara evidence EVD-NX-24-TARGETS
:mid: 01M7A4FCEFW4N06285629BJCB1
:title: What Nx 24.0.6 does with continuous, sequential and overlapping targets
:status: accepted
:supports: DES-TARGET-COMMANDS
:supports: DES-WORKSPACE-TARGETS
:supports: DES-OUTPUTS
:supports: ADR-NX-TARGET-NAMES

An experiment and a reading of the `nx`, `@nx/js` and `@nx/workspace` 24.0.6 packages installed in this repository, on 13 November 2026, with Node.js 26.12.0. The experiment used a throwaway workspace outside this repository with two projects, `a` and `b`, whose targets ran shell commands through `nx:run-commands`. Nx ran as `node <repository>/node_modules/nx/dist/bin/nx.js` with `NX_DAEMON=false`, `NX_NO_CLOUD=true` and `NX_TUI=false`.

- **Overlapping outputs.** Each project's cached `doc` target wrote a folder of its own under `out/doc` and a shared `out/doc/crates.js`, and declared `{workspaceRoot}/out/doc` as its output. After `nx run a:doc` and `nx run b:doc`, `out/doc` held both folders. A second `nx run a:doc` was a cache hit, after which `out/doc` held only `a`'s folder and `a`'s `crates.js`: the restore replaced the whole folder. The native cache documents `copyFilesFromCache` as replacing each output that exists (`native/index.d.ts`).
- **Continuous tasks that exit.** A target with `continuous: true` printed a line and exited. Run alone with `nx run a:oneshot`, it succeeded. As the dependency of another target, `nx run a:after` failed with `Task "a:oneshot" is continuous but exited with code 0` and exit code 1 (`tasks-runner/task-orchestrator.js`).
- **A project without a target.** `nx run a` failed with "Both project and target have to be specified".
- **Batches.** Without `--batch`, a task joins a batch only if its executor has a batch implementation and sets `preferBatch`, and only if the task's `parallelism` is not `false`. A continuous task stays out of a batch only when another task depends on it or it declares `readyWhen` (`processTaskForBatches` and `canBatchTaskBeScheduled` in `tasks-runner/tasks-schedule.js`).
- **Parallelism.** While a task with `parallelism: false` runs, no other task starts, and such a task starts only when no other task runs (`canBeScheduled` in `tasks-runner/tasks-schedule.js`).
- **Readiness.** A target accepts `continuous`, `readyWhen` and `parallelism` (`schemas/project-schema.json`). `readyWhen` waits for a `url`, a `port`, a `command` or `logMatches`, and a dependent waits for it only with `waitFor: "ready"` on its `dependsOn` entry; the default is `started`.
- **nx watch.** `nx watch` runs its command once for each batch of changes and takes the next batch only after the command has exited, so it cannot restart a command that keeps running (`command-line/watch/watch.js`).
- **Command names.** `run` and `watch` are Nx commands, so `nx run <project>` never runs a target named `run`. `check`, `doc`, `bench`, `fmt`, `fmt-check`, `audit`, `deny`, `update` and `typecheck` are not command names (the command handlers of `command-line/nx-commands.js` and `isKnownCommand` in `bin/init-local.js`).
- **typecheck.** `@nx/js` adds its TypeScript plugin with the target name `typecheck` (`src/utils/typescript/add-typescript-plugin.js`), and the CI workflow generator of `@nx/workspace` writes `nx affected -t lint test build typecheck` when a workspace has that target (`src/generators/ci-workflow/ci-workflow.js`).

The targets of the experiment ran no cargo. The points marked with a source file were read, not run.
:::

:::mara evidence EVD-NX-24-EXTERNAL-NODES
:mid: 01M7ACCPE3NW5Z2SMKCY08AV3H
:title: What Nx 24.0.6 does with external nodes, externalDependencies and a lockfile it does not parse
:status: accepted
:supports: ADR-LOCKFILE-TASK
:supports: DES-INPUTS
:supports: DES-LOCKFILE-HASHING

Experiments on 13 November 2026 with `nx` 24.0.6, pnpm 12.18.0, Node 26.12.0 and git 2.56.0 on Linux x86-64. The throwaway workspace lay outside this repository, was installed with `pnpm install --offline` and had the default task-based affected. A local plugin made the projects `a`, `b` and `c` from `rust/crates/*/Cargo.toml` and read a hand-written `rust/Cargo.lock` in Cargo's version 4 format, in which `a` depended on `serde`, `serde` on `serde_derive`, `b` on `itoa` and `c` on `a`. It turned every package with a `source` into an external node `cargo:<name>@<version>` of type `cargo`, with the package's checksum as `data.hash`. Its `createDependencies` returned an edge from each crate to its direct external dependencies, an edge from each external node to those its lockfile entry lists, and the project edge from `c` to `a`. The targets used `nx:run-commands`, `nx:noop` and an executor from a package installed with `file:`; a JS project listed in `pnpm-workspace.yaml` added a `package.json` script. Hashes came from Nx's own hasher: a script built the graph with `createProjectGraphAsync` and the task graph with `createTaskGraph`, called `InProcessTaskHasher.hashTask` and printed each task's hash with its parts, all with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false`; `HashPlanInspector` printed the plans. Selection came from `nx affected -t <target> --base=HEAD~1 --head=HEAD --explain=stdout` after a commit.

- **Every external node by default.** A target without an `externalDependencies` input hashed `AllExternalDependencies`, every external node of the graph, npm and `cargo:` alike. That held for `nx:run-commands`, `nx:noop`, the executor from a package and the `package.json` script (`nx:run-script`), whose hash changed when only the hash of `cargo:itoa@1.0.0` changed. An `externalDependencies` input, an empty one included, removed it.
- **Edges and `^` inputs.** With edges from projects to external nodes, a `^` input such as `^default` hashed the project's direct external nodes and, along the edges between external nodes, the nodes behind them: `serde` and `serde_derive` for `a`, and the same for `c` through its edge to `a`. A target without a `^` input hashed none of them.
- **Named nodes.** `externalDependencies: ["cargo:serde@1.0.0"]` hashed that node and `serde_derive` behind it, and `["@exp/executor"]`, a bare package name, resolved to its `npm:` node. A name without a node failed hashing with "The externalDependency 'cargo:does-not-exist' for 'a:rc-extmissing' could not be found". A package name failed in the same way when `nx.json` set `pluginsConfig["@nx/js"].analyzeLockfile` to `false`, which leaves the graph without npm nodes.
- **The `hash` field.** A changed checksum with the version unchanged changed the keys of exactly the tasks that reached the node. Without `data.hash`, a changed checksum changed no key, while a changed version, which renamed the node, did.
- **One name twice.** When two `createNodes` results declared one node name with different hashes, the graph kept the last one, without a message.
- **Affected.** After a commit that changed only `rust/Cargo.lock`, and with it the hash of `cargo:serde@1.0.0`, `nx affected` selected no task that reached that node, whether through a `^` input, `externalDependencies` or `AllExternalDependencies`. Only tasks with the lockfile as a file input were selected. Adding `Cargo.lock` to the plugin's `createNodes` pattern changed nothing. Neither did a per-crate digest that the plugin put into a target option, although the option changed the task's key through the project's configuration. As read in the installed source, Nx works out which external nodes moved only from the JS lockfiles and `package.json` (`dependencyChanges` in `project-graph/affected/affected-tasks.js`, `plugins/js/project-graph/affected/lock-file-changes.js`), and the plugin interface has no hook through which a plugin could report moved nodes (`project-graph/plugins/public-api.d.ts`).
- **A JS lockfile.** After a commit that changed one integrity entry of `pnpm-lock.yaml`, with Nx's default `projectsAffectedByDependencyUpdates`, `nx affected` selected every crate target without an `externalDependencies` input, with the reason `external-dependencies`, and none of those with an empty one. A target that names an npm package fares otherwise, and the setting decides how ([[EVD-NX-24-PLUGIN-VERSION]]).
- **Graph creation.** With the project graph cache on and the daemon off, a change to `Cargo.lock` alone made the next command create the graph again, and the node's hash followed the file.

The daemon was off throughout, the lockfile was written by hand and no cargo ran.
:::

:::mara evidence EVD-NX-24-PLUGIN-VERSION
:mid: 01M7AEAST02RW3QQS2PRMN6R21
:title: How Nx 24.0.6 hashes a plugin's package, its dependencies and a project's configuration
:status: accepted
:supports: DES-INPUTS
:supports: DES-LOCKFILE-HASHING

Experiments on 13 November 2026 with `nx` 24.0.6, pnpm 12.18.0, Node 26.12.0 and git 2.56.0 on Linux x86-64, in a throwaway workspace outside this repository installed with `pnpm install --offline`. An executor package `@exp/executor`, installed with `file:`, depended on `tslib` 2.9.1. A stand-in plugin, listed in `nx.json` by its path and not installed as a package, gave two crate projects `a` and `b` the targets `t` and `u` with that executor, their own files as input, and an `externalDependencies` input naming the plugin's package, the executor's package or nothing, as each case required. Hashes came from `InProcessTaskHasher.hashTask` as in [[EVD-NX-24-EXTERNAL-NODES]], with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false`, and the selection from `nx affected -t t --base=HEAD~1 --head=HEAD --explain=stdout` after a commit.

- **No node for the plugin.** Naming the path-loaded plugin's own package, which the lockfile did not list, failed the hash: "The externalDependency '@exp/nxr' for 'a:t' could not be found". The executor's package, which `pnpm-lock.yaml` lists, had a node, but no longer once `pnpm-lock.yaml` was listed in `.gitignore` and taken out of the index, and naming it then failed in the same way. As read in the installed source, Nx creates npm nodes only from a lockfile in its file map, and its lockfile analysis is off when `pluginsConfig["@nx/js"].analyzeLockfile` is `false`, and by default, unless `nx.json` sets it, without a root `package.json` or with a `lerna.json` and no `nx.json` (`plugins/js/index.js`, `plugins/js/utils/config.js`).
- **What of a project's configuration Nx hashes.** A changed value in the options of `t` changed the key of `a:t`, and so did one in the options of `u`, in the configurations of `t`, in the project's tags and in `parallelism` of `t`. A change in the `metadata` of `t` or of the project, a named input that no target used, `dependsOn` or `cache` did not. With `externalDependencies: []`, a value standing for the plugin's version in the options of `t` changed the key from one version to the next, and hashing did not fail.
- **The package's dependencies.** With `externalDependencies: ["@exp/executor"]`, the key held `npm:tslib@2.9.1` as well, and a changed integrity of `tslib` in `pnpm-lock.yaml` changed it. A changed integrity of `@clack/core`, on which the executor's package does not depend, left it unchanged.
- **nx affected after a JS lockfile change.** Under Nx's default `projectsAffectedByDependencyUpdates`, which is `all` (`plugins/js/utils/config.js`), the commit that changed `@clack/core` selected `a:t` and `b:t` with the reason `moved-ecosystem` for `npm`, although their keys had not changed; with `externalDependencies: []` it selected neither. With `"projectsAffectedByDependencyUpdates": "auto"` in the `@nx/js` section of `pluginsConfig`, that commit selected neither, and a commit that changed `tslib` selected both, with `npm:tslib@2.9.1` as the reason.
:::

:::mara evidence EVD-NX-24-LOCKFILE-TASK
:mid: 01M7ACCPE3Z4TVZ0EBZZVXR4PP
:title: How a lockfile task keys crates and drives nx affected in Nx 24.0.6
:status: accepted
:supports: ADR-LOCKFILE-TASK
:supports: DES-LOCKFILE-HASHING
:supports: DES-INPUTS
:supports: REQ-NO-RUST-TASK-DEPS

Experiments on 13 November 2026 with the versions of [[EVD-NX-24-EXTERNAL-NODES]] and cargo 1.100.0, in throwaway workspaces outside this repository. In these runs the lockfile task was cached and wrote its digests without running cargo; [[EVD-NX-24-LOCKFILE-UPDATE]] has the task as it is now.

The first was the workspace of that item without its external nodes. A project at `rust/` had a cached `nx:run-commands` target that read `rust/Cargo.lock` and wrote, into a git-ignored folder, one file per crate holding a SHA-256 over the name, version, source and checksum of every package the crate's lockfile entry reaches. Each crate had a cached target that depended on it and declared `{ "dependentTasksOutputFiles": "<folder>/<crate>.digest" }` and `externalDependencies: []` besides its own files and a `^` input over them.

The second held a Cargo workspace at `rust/` whose root manifest also is the package `root`, with the members `a`, which depends on `itoa`, `b`, which depends on `ryu`, and `c`, which depends by path on `a` and on `root`. The project of `root` carried the lockfile task. Every crate had a cached `test` target that depended on it and read the crate's digest as in the first workspace, run by an executor from a local package with a `batchImplementation` and `preferBatch: true` that logged its calls. The lockfile task and the `test` targets named that package in `externalDependencies`. A crate's own files were the input `{projectRoot}/**/*` with `!{projectRoot}/Cargo.lock`, unless a case says otherwise. Bumps came from `cargo update -p <crate> --precise <version>`, and every run was `nx run-many -t test --outputStyle=static` with `NX_DAEMON=false`, except where the daemon was started with `nx daemon --start`.

- **Keys.** A bump changed the keys of exactly the crates that reach the package. In the first workspace, a bump of `serde_derive`, which `a` and `c` reach only through `serde`, ran `a` and `c` and restored `b` from the cache, and a bump of `itoa` did the reverse. In the second, a bump of `itoa` ran `a` and `c`, and one of `ryu` ran `b` only. The lockfile task ran again after every bump.
- **Affected.** After a commit that changed only the lockfile, `nx affected -t test` selected the lockfile task through `rust/Cargo.lock` and every crate task of the workspace, with the reason `dependent-output` and the lockfile task as producer. Running it executed the crates whose digest had changed and restored the others from the cache.
- **Batching.** The lockfile task ran first and on its own. The four `test` tasks then reached the executor as one batch, and after a bump only those that had to run did, again as one batch.
- **Where the digests live.** With the digests in `.nx/workspace-data/nx-rust/<workspace>`, in `node_modules/.cache/nx-rust/<workspace>` or in the artifact directory `rust/target/nx-rust/lockfile`, a second run restored every task from the cache. After the folder was deleted, the next run restored the lockfile task from the cache, its files included, and every crate task with it. `git status` showed nothing new in any of the three. With the folder outside the repository, the lockfile task ran again after a bump of `itoa` and wrote a new digest, but `a` and `c` were restored from the cache: Nx did not hash a dependency's output that lies outside the workspace. With the daemon on and the digests in `.nx/workspace-data`, the runs gave the same results as without it.
- **Root package.** Without `!{projectRoot}/Cargo.lock`, the files of `root` included `rust/Cargo.lock` and no file of a member, and a bump of `ryu`, which only `b` reaches, ran `root` and `c`, which depends on `root`, besides `b`. With it, only `b` ran.
- **Git-ignored lockfile.** With `Cargo.lock` listed in `rust/.gitignore` and removed from the index, a plain file input did not see a bump: the lockfile task was restored from the cache with the old digests, and every crate task with it. With `{ "fileset": "{projectRoot}/Cargo.lock", "includeIgnored": true }`, the lockfile task ran again, and `a` and `c` after it.

A third workspace on the same day tried a comparison, written by the plugin, of each lockfile entry with the dependencies that the manifests declare, with one digest over the whole lockfile and the declarations for every crate whenever they differed. It ran `a`, `b` and `c` where digests over the stale lockfile alone had restored `a` and `c` after a member's new requirement. The review of pull request #14 then found states it missed, and cargo's own check replaced it ([[EVD-CARGO-LOCK-CHECK]]). In that workspace, with the task still cached, a deleted or overwritten digest folder came back with the task from the cache.

`nx init` writes `.nx/workspace-data` into `.gitignore` (`command-line/init/implementation/utils.js`), and a comment in `daemon/server/restart-checks.js` calls that folder hardcoded-ignored by the daemon's file watcher; both were read, not run. No cargo build ran inside Nx: the executors only logged.
:::

:::mara evidence EVD-CARGO-LOCKFILE
:mid: 01M7ACCPE3XWH5NE1AJ970AVQH
:title: What Cargo.lock records, and how a build of the whole workspace unifies features
:status: accepted
:supports: DES-LOCKFILE-HASHING
:supports: DES-INPUTS

An experiment on 13 November 2026 with cargo and rustc 1.100.0 on Linux x86-64, outside this repository, with crates.io reachable. The workspace had the members `a`, `b`, `f1` and `f2`. `a` had a normal dependency on `itoa = "1"`, an optional one on `smallvec` that no feature enabled, `ryu` as a dev-dependency, `cfg-if` as a build dependency and `memchr` under `[target.'cfg(windows)'.dependencies]`. `b` depended on `itoa = "0.4"`, on a crate in a local git repository and by path on `v`, a crate outside the workspace that depends on `ryu`. `f1` and `f2` depended by path on `x`, a crate outside the workspace with a feature `f` and a function that returns `cfg!(feature = "f")`. `f2` enabled `f` and `f1` did not; `f1` was a binary that printed the function's result. `cargo generate-lockfile` wrote the lockfile.

- **A member's entry.** The entry of `a` listed `cfg-if`, `itoa 1.0.19`, `memchr`, `ryu` and `smallvec`: its normal, dev and build dependencies, the dependency for another platform and the optional one that nothing enabled. The lockfile records no features.
- **Several versions.** `itoa` was locked at 0.4.8 and at 1.0.19, and an entry names such a dependency with its version, as in `"itoa 0.4.8"`.
- **Sources.** A registry package had a `source` and a `checksum`. The git dependency had `source = "git+file:///…#<commit>"`, ending in the commit, and no checksum.
- **Path packages.** `v` and `x` had neither `source` nor `checksum`, and the entry of `v` listed `ryu`.
- **Features of another member.** `cargo run -p f1` printed `false`. After `cargo build --workspace`, `target/debug/f1` printed `true`: built together with `f2`, `x` had the feature that `f2` enables.

`x` is a path crate. Cargo's resolver unifies the features of a registry crate in the same way, which this experiment did not run.

A second experiment on the same day used a workspace with the members `a`; `b`, which depends on `itoa = "1"` and by path on `v`, a crate outside the workspace with `cfg-if` as a dependency and `ryu` as a dev-dependency; and `c`, which depends on `a`. `cargo update -p itoa --precise` wrote two lockfiles, with `itoa` at 1.0.17 and at 1.0.19.

- **Dev-dependencies of other path packages.** The entry of `v` listed `cfg-if` and not `ryu`, and no `ryu` was locked: a lockfile records the dev-dependencies of workspace members only.
- **Stale lockfile.** With `itoa = "1"` added to the manifest of `a` and either lockfile in place, the entry of `a` listed nothing. `cargo build -p a` rewrote the lockfile, gave `a` an `itoa` dependency and kept the version that lockfile had locked, 1.0.17 or 1.0.19.
- **A sibling.** With `itoa = "=1.0.10"` in the manifest of `a` and the lockfile with 1.0.19, whose entry for `b` matched `b`'s manifest, `cargo build -p b` resolved the workspace again, and `cargo tree -p b` then showed `itoa` 1.0.10.
:::

:::mara evidence EVD-CARGO-LOCK-CHECK
:mid: 01M7ANS8X2N5DQ2844PTFSYCA0
:title: How cargo judges and updates Cargo.lock, and what a current lockfile fixes
:status: accepted
:supports: DES-LOCKFILE-HASHING
:supports: ADR-LOCKFILE-TASK

Experiments on 13 November 2026 with cargo 1.100.0 and 1.91.0 on Linux x86-64, crates.io reachable, re-run in the fixtures of the lockfile research for this issue. One workspace has the members `a` (`smallvec`, `itoa = "1"`), `b` (`serde`, `ryu`, a git dependency and `v`, a path crate outside the workspace) and `c` (`a`); each case was applied to its committed, current state. Another uses a local registry in which versions can be published. The digest is the closure of [[DES-LOCKFILE-HASHING]], computed by a script from `Cargo.lock`, and the packages compiled for a crate came from `cargo check -p <crate> --message-format json`.

- **The verdict.** In each state, `cargo update --workspace --locked`, `cargo metadata --locked` and `cargo check --workspace --locked` agreed. All three exited 0 for the committed state and for a removed member. They exited 101 for a requirement in `b` that moves a version `a` shares (`itoa = "=1.0.10"`), a feature in `a` that adds packages (`smallvec` with `serde`), an added `[replace]`, a same-version `[patch]` in `$CARGO_HOME/config.toml` and an unsatisfied requirement, on 1.100.0 and, for the first three, on 1.91.0. The message contains "--locked was passed to prevent this" on both. The research found the same agreement in 27 states on both toolchains, and that the check needs only the index entries of the locked packages, writes nothing to the repository or the build directory, and took 22 to 250 ms on a warm cargo home and up to 1.7 s, 4.5 s with 1.91.0, on a cold one with 493 locked packages.
- **The update.** For 14 stale states and a missing lockfile, `cargo update --workspace` wrote the same bytes as plain `cargo check --workspace`. The stale states were a removed dependency, an unsatisfied requirement, the sibling's requirement, the feature, `[patch]` in the root manifest, in the repository's and in the cargo home's configuration, a newer-version `[patch]`, `[replace]`, a new version and a new dependency of `v`, a `branch` on the git dependency, and an added member. On the current lockfile it wrote nothing and kept the file's modification time.
- **Digests.** After the update, the digest of `a` followed what `a` compiles: `itoa` 1.0.10 after the sibling's requirement, the path crate after `[replace]` and after the cargo-home `[patch]`, and a closure with `serde` after the feature. In every state, the packages compiled for `a` and `b` lay inside their closures. Without following `replace = …`, the digest of `a` stayed the same with `[replace]`, while `a` compiled the path crate. With a member removed, plain `cargo check` rewrote the current lockfile, and the digests of the remaining members stayed the same.
- **Identical files, two resolutions.** In the local-registry workspace, with `yylib = "1"` added to a manifest and the lockfile not updated, all files hashed alike in two runs. `cargo update --workspace` added `yylib` 1.0.0 while the registry held only that version, and 1.0.1 once it was published, and the crate's digest changed with it. `--locked` called the lockfile stale both times.
- **cargo fmt.** `cargo fmt` and `cargo fmt --check` left a stale lockfile unchanged with both toolchains.
- **Edges.** In a local registry with `zzlib` 1.0.0 and 2.0.0 and a `wrapper` that depends on `zzlib >=1, <3`, a binary depending on both `zzlib` versions and on `wrapper` was locked once with `wrapper` on `zzlib` 2.0.0 and once, by editing that entry, on 1.0.0. `cargo update --workspace --locked` exited 0 in both states with both toolchains, `cargo run --locked` printed `1 2 2` and `1 2 1`, and a digest over the packages alone was the same in both. The digest that also covers each entry's dependency strings differed. With it, the cases above changed the same digests as before.

The research also found that a `paths` override in `.cargo/config.toml` is compiled while cargo calls the lockfile current and leaves no trace in it; that was not re-run.
:::

:::mara evidence EVD-NX-24-LOCKFILE-UPDATE
:mid: 01M7ANS8X2BSA42J4X4E6QFP0R
:title: How Nx 24.0.6 runs an uncached lockfile task that lets cargo update Cargo.lock
:status: accepted
:supports: DES-LOCKFILE-HASHING
:supports: ADR-LOCKFILE-TASK
:supports: DES-INPUTS

Experiments on 13 November 2026 with `nx` 24.0.6, Node 26.12.0 and cargo 1.100.0, with `NX_DAEMON=false`, re-run in the Nx workspace of the lockfile research for this issue. Its Cargo workspace `rust/` has the members `a` (`smallvec`, `itoa = "1"`), `b` (`serde`, `ryu`, `itoa = "=1.0.10"`, `memchr`) and `c` (`a`). The project `rust` had an uncached `lockfile` target that ran `cargo update --workspace`, with `--locked` under `NX_RUST_LOCKED=true`, and then wrote the closure digest of each member into `.nx/workspace-data/nx-rust/lockfile/rust`, declared as its outputs. Its inputs were `Cargo.lock` with `includeIgnored`, the root manifest and `{workspaceRoot}/rust/*/Cargo.toml`. Each crate had a cached `check` target that depended on it, ran `cargo check -p`, and hashed its digest through `dependentTasksOutputFiles`. With `POSTCHECK=digest`, it computed the crate's digest again after its call and failed when that differed from the digest file.

- **Every run.** On a second run with nothing changed, the lockfile task ran and every crate was restored from the cache.
- **A stale lockfile.** With `b`'s requirement changed to `itoa = "=1.0.11"`, the lockfile task printed cargo's "Updating itoa v1.0.10 -> v1.0.11", and `a`, `b` and `c` ran on new digests. With the manifest and the lockfile reverted, all three were restored. When the task wrote digests from the stale lockfile without running cargo, only `b` ran: `a` and `c` were restored, although `a` compiles the new `itoa`.
- **Locked mode.** With `NX_RUST_LOCKED=true` and the stale lockfile, the lockfile task failed with cargo's message. Nx listed the crate tasks under "Tasks not run because their dependencies failed" and exited 1, and `Cargo.lock` was unchanged.
- **A plain file input.** A cached target that depended on the lockfile task and had `Cargo.lock` as a plain file input was restored, in the run in which the task rewrote the lockfile, with its result for the old lockfile. It ran on the next run.
- **Post-check.** With `b`'s manifest changed while `a`'s cargo call ran, cargo rewrote `Cargo.lock` during that call, and the digest of `a` no longer matched its digest file. The task failed, and Nx stored nothing for it. The next run ran `a`, `b` and `c` on the new digests.
- **nx affected.** A commit that changed only `b/Cargo.toml` selected `rust:lockfile`, `a:check`, `b:check` and `c:check`.
- **Excluded dependencies.** Without help, the review of pull request #14 found, `nx run a:check --exclude-task-dependencies` was restored from the cache after `cargo update -p smallvec --precise 1.15.1`. A stand-in `preTasksExecution` hook parsed the command's arguments with Nx's own `yargs-parser` and set an environment variable to a new value when they excluded task dependencies, and to the empty string otherwise. The crates' `check` targets had it as an `env` input. After a normal run, `nx run a:check --exclude-task-dependencies` ran `a`, and after `cargo update -p smallvec --precise 1.15.1` the same command ran it again. `nx run-many -t check --excludeTaskDependencies` and `nx affected -t check --exclude-task-dependencies=true` ran their tasks too, and `--no-exclude-task-dependencies` gave a normal run. A normal run afterwards restored every task, with the daemon off and on, and the keys of normal runs were the same in both modes. With the variable unset and the hook not setting it, a normal run was restored as well.
- **What Nx stores.** As read in `tasks-runner/task-orchestrator.js`, Nx stores a result only when the task is cached and its exit code is 0, or with `NX_CACHE_FAILURES=true` whatever the code. Failing is the only way for a task to keep its result out of the cache.

The research also reported, without a re-run here: inputs written as `{projectRoot}/*/Cargo.toml` missed the members' manifests, which belong to nested projects; and with the task cached and its inputs complete, a `[patch]` in `$CARGO_HOME/config.toml` let the task, `a` and `c` be restored although cargo called the lockfile stale.
:::

:::mara evidence EVD-CARGO-DEP-INFO
:mid: 01M7ACMK1Q7ATJKRRHC2WPJE1Z
:title: Where Cargo records the files that build scripts and macros read
:status: accepted
:supports: ADR-DECLARED-FILE-INPUTS
:supports: DES-BUILD-INPUT-CHECK
:supports: RISK-UNDECLARED-INPUTS

Experiments on 13 November 2026 with cargo and rustc 1.100.0 (cargo 3acc79c0c 2026-11-05) and, where named, cargo 1.98.1, 1.97.1 and 1.91.0, on Linux x86-64, in throwaway folders outside this repository, with no Cargo configuration in the home folder and no toolchain pinned. The fixture was a virtual workspace `ws` with the members `app` and `dep`, beside the folders `proto`, `shared` and `assets` outside it. `app` depended on `dep` by path. Its build script printed `cargo::rerun-if-changed` for `../../../proto/app.proto`, for the folder `../../../assets` and for `build.rs`, read the proto file and set a variable with `cargo::rustc-env`; its library used `include_str!` on `shared/data.txt`, its binary called the library, and an integration test used `include_bytes!` on `shared/test-data.bin`. `dep`'s build script named `../../../proto/dep.proto`, and its library included `shared/dep.txt`. Later steps added `pm`, a proc-macro crate whose macro read `shared/pm.txt` with `std::fs`, used by `app2`, which also depended on the registry crate `libc` (built with `--offline` from the local registry cache); `gen`, whose build script wrote a file into `OUT_DIR`, which its library included with `include!`, and named `/etc/hostname`; and `cd`, with the crate types `cdylib`, `rlib` and `staticlib`, whose library included a file with a space in its name.

- **check, clippy, test and doc.** After `cargo check --workspace`, `cargo clippy --workspace --all-targets`, `cargo test --workspace --no-run` and `cargo doc --workspace`, `find target -name '*.d'` showed dependency files only under `target/debug/build/<package>/<hash>/out/`, in the build directory of the default layout, and none in `target/debug` itself or in `target/doc`. The build script's `rerun-if-changed` lines were in `build/<package>/<hash>/run/stdout`, and its fingerprint `run-build-script-build-script-build.json` listed the paths under `RerunIfChanged`, relative to the package's folder. rustc's dependency file for the library, `out/app-<hash>.d`, listed `crates/app/src/../../../../shared/data.txt` beside the source, and an `# env-dep:PROTO_LEN=7` line. The file that the integration test included appeared only in the test's dependency file in the build directory.
- **build.** `cargo build --workspace` also wrote `target/debug/app.d`, `libapp.d` and `libdep.d` beside the binary and the `rlib` files, in Makefile syntax with absolute paths. `app.d` listed both proto files, the `assets` folder as one path, both build scripts, both included text files and the sources of `app` and `dep`; `libdep.d` listed only `dep`'s files. None listed the file of the integration test. With `build.build-dir` set to a folder outside the workspace, the three files stayed in `target/debug`, and every other dependency file was in the build directory. With cargo 1.97.1 and the same setting, `cargo build --workspace` wrote the three files in `target/debug` as well, and the build script's record lay at `<build directory>/debug/build/app-<hash>/output` instead.
- **More of build.** `app2.d` listed the sources of `app2` and `pm` and no file of `libc`. `libgen.d` listed `/etc/hostname` and the generated file under `target/debug/build/`. For `cd`, Cargo wrote `libcd.a`, `libcd.rlib`, `libcd.so` and a single `libcd.d`, which escaped the space as `with\ space.txt`. After a change to `app`'s library, `cargo build -p app` wrote `app.d` and `libapp.d` again and not `libdep.d`. After `app.d` was deleted, `cargo build -p app` compiled nothing and wrote it again. With `--config build.dep-info-basedir=<folder>`, the paths were relative to that folder.
- **Fresh builds.** Whether a build that compiles nothing gives the records a new time differs between versions and crates. In a second workspace with three crates, one without a build script, one whose build script named only `build.rs` with `rerun-if-changed`, and one whose build script named a folder, two further `cargo build --workspace` runs with cargo 1.100.0 kept the time of all three records; with cargo 1.98.1 and 1.97.1 they kept the time of the crate without a build script and gave the other two new times. In the first fixture, cargo 1.100.0 gave `app.d` and `libapp.d` a new time on each of three fresh builds of `app`. With all three versions, a deleted record was there again after the next build, which compiled nothing. A record is thus present after every successful build, and its time says nothing about that build.
- **Stale records.** `cargo build -p dep` wrote `libdep.d` for the library-only crate `dep`, listing `proto/dep.proto` and `shared/dep.txt`. After `app` got a second binary `extra` with `required-features = ["x"]`, `cargo build -p app --features x` wrote `extra.d`, and a later `cargo build -p app` left it with its old time. `cargo build -p app --release` and `cargo build -p app --target x86_64-unknown-linux-gnu` wrote `app.d` and `libapp.d` in `target/release` and `target/x86_64-unknown-linux-gnu/debug`, beside those in `target/debug`. A crate `wide` whose build script printed `cargo::rerun-if-changed=../..` got `crates/wide/../..`, the workspace folder that holds `target`, as one path in `libwide.d`.
- **Which records a build exports.** A third workspace, built with debug information and incremental compilation off to save space, had a library-only crate `lib-only`; a crate `multi` with the library `multicore`, the binaries `one`, `two-dash` and `three`, the last with `required-features = ["extra"]`, and a feature `full = ["extra"]`; a crate `cd` with the crate types `cdylib` and `staticlib`; a proc-macro crate `pm`; and a profile `fast` that inherits `release`. A script named the records that `cargo build -p <crate>` should export from the `cargo metadata --no-deps` report and the build's features, profile and triple, and compared them, in thirteen builds, with the files outside the build directory that the `compiler-artifact` messages of the same build with `--message-format=json` named, the messages serving only as a check. Every build agreed: `multi` without features, with `--features extra`, `--features full` and `--all-features`, with `--release`, `--profile fast` (folder `target/fast`), `--target x86_64-unknown-linux-gnu` alone and with `--release` (folder `target/x86_64-unknown-linux-gnu/<profile>`), and with `CARGO_BUILD_TARGET` set to that triple and no `--target` (the same folder); `lib-only`; `cd` in `dev` and `release`; and `pm`. The library's record was `lib<name>.d` with `-` replaced by `_` (`liblib_only.d`, `libmulticore.d`, `libcd.d`, `libpm.d`), a binary's kept its name (`two-dash.d`), and `three.d` was exported exactly when `extra` was on.
- **The naming matrix.** A fourth workspace had eight crates: libraries of the crate types `rlib` (the crate `k-rlib`), `cdylib`, `staticlib`, all three together, and `proc-macro`; a crate with a binary only; one with a library and the binary `k-libbin-cli`; and a proc macro with a binary. Its root manifest defined the profiles `c_dev`, `c_release`, `c_test` and `c_bench`, each with `inherits` naming the profile of that name without `c_`. Each crate was built on its own with `cargo build -p <crate> --profile <profile> --message-format=json` for each of the eight profiles, under each triple mode: no triple, `--target x86_64-unknown-linux-gnu` (the host), `--target x86_64-unknown-linux-musl` (with 1.100.0, the only toolchain with another triple installed), `CARGO_BUILD_TARGET` set to the host triple, and `[build] target` set to the host triple in `.cargo/config.toml`. For every build, a script named the records from the `cargo metadata --no-deps` report, the profile and the triple, and compared them with the files that the `compiler-artifact` messages named outside the build directory, the messages serving only as a check. With cargo 1.100.0, 256 of 320 builds agreed. The 56 builds where the configuration chose the triple differed for every crate but the plain proc macro: cargo wrote the records to `target/x86_64-unknown-linux-gnu/<profile>`, and the names, which knew no triple, pointed at `target/<profile>`. In those builds a record of the same name lay in the triple folder after the call, and a proc macro's library record, in `target/<profile>`, agreed. For the `cdylib`-only crate and the musl triple, the 8 builds failed with "cannot produce cdylib … as the target `x86_64-unknown-linux-musl` does not support these crate types"; for the crate with all three types, cargo warned "dropping unsupported crate type `cdylib`" and wrote `libk_multi.d`, as named. With cargo 1.91.0, 200 of 256 builds agreed, and the other 56 were the configured-triple builds again. Together the builds showed: a proc macro's library record lies in `target/<profile folder>` whatever the triple, while a binary of the same crate follows the triple; `test` writes to `debug` and `bench` to `release`, like `dev` and `release`; and a custom profile writes to a folder of its own name, whichever profile it inherits from. In the shared target folder, once a build for a named triple had left a record of the same name there, the check's guard for a triple it cannot know also skipped the host-folder records of 14 later builds without a triple, with each toolchain.
- **Records after a change.** In fresh workspaces with one crate and the files `old.txt`, `new.txt`, `a.txt` and `b.txt` beside it, with cargo 1.91.0 and 1.100.0 alike: an `rlib` that included `old.txt`, built with `--target x86_64-unknown-linux-gnu`, then turned into a proc macro that included `new.txt` and built the same way, left `target/x86_64-unknown-linux-gnu/debug/libc.d` listing `old.txt` and wrote `target/debug/libc.d` listing `new.txt`; turned back into an `rlib` that included `old.txt`, it wrote the triple folder's record again, listing `old.txt`, and left the host folder's listing `new.txt`. A `--release` build that included `old.txt`, followed by a change to `new.txt` and a `dev` build, left `release/libc.d` listing `old.txt` and wrote `debug/libc.d` listing `new.txt`; the same held for a build with `--target` followed by one without. A crate with a feature `x` that included `a.txt` with it and `b.txt` without it, built with `x`, without, with `x` and with `x` again, compiled one unit, one, none and none, and `debug/libc.d` listed `a.txt`, `b.txt`, `a.txt` and `a.txt`: a record follows the call's feature set also when nothing compiles. After a binary `two` was removed from the manifest, the next build left `debug/two.d` in place.
- **Where such names fall short.** With `[build] target = "x86_64-unknown-linux-gnu"` in `.cargo/config.toml` and no `--target`, `cargo build -p multi` exported its records to `target/x86_64-unknown-linux-gnu/debug`, while an older `target/debug/one.d` remained. `cargo build -p multi -p user`, where `user` depends on `multi` with `features = ["extra"]`, built and exported `three` as well. Two crates `cola` and `colb` with a binary `cli` each, built in one call, gave the warning "output filename collision" and one `cli.d`, which listed only `colb`'s source. `cargo build -p multi --bin one` reported the library only by its files in the build directory and exported only `one.d`, which listed the library's source beside the binary's.
- **Links.** A crate `linky` whose library used `include_str!` on `shared/alias.txt`, a symbolic link to `shared/data.txt`, got the link's spelling `crates/linky/src/../../../shared/alias.txt` in `liblinky.d`. After `data.txt` changed, `cargo build -p linky -v` reported `linky` dirty, naming that path, and compiled it again.
- **JSON messages.** `cargo build --workspace --message-format=json` gave `build-script-executed` messages with the keys `cfgs`, `env`, `linked_libs`, `linked_paths`, `out_dir`, `package_id` and `reason`, and `compiler-artifact` messages whose `filenames` held the artifacts and no dependency file. No message named a `rerun-if-changed` path.
- **What Cargo tracks.** After `proto/app.proto` changed, the next `cargo build` ran `app`'s build script and compiled `app` again. `cargo build -p app -v` reported `app` dirty, naming the path `crates/app/../../../assets`, after a file in that folder changed and again after a file was added to it. After `shared/pm.txt` changed, `cargo build -p app2` finished in 0.00s without compiling, and the binary still printed the old content: Cargo does not track a file that a proc macro opens itself.
- **Build helpers.** In the sources in the local registry, tauri-build 2.6.3 prints `cargo:rerun-if-changed` for paths it computes from its configuration (`src/codegen/context.rs`, from line 91), and bindgen 0.72.1 prints it for the headers that a binding includes (`lib.rs`, lines 1302 and 1307). include_dir 0.7.4 tracks a folder only with its `nightly` feature, through `proc_macro::tracked_path`, and otherwise expands to an `include_bytes!` per file (`include_dir_macros/src/lib.rs`).
- **Documentation.** The Cargo book of the 1.100.0 toolchain (`reference/build-cache.html`, "Dep-info files") says that the file with the `.d` suffix next to each compiled artifact indicates the files the artifact depends on, that these files are "intended to be used with external build systems", and that their paths are absolute unless `build.dep-info-basedir` is set. The same page calls the intermediate artifacts in the build directory "internal to Cargo and the Rust compiler".

The workspace was a toy on Linux, so the names of macOS libraries, such as `.dylib`, were not seen.
:::

:::mara evidence EVD-NX-24-FILE-INPUTS
:mid: 01M7ACMK1QCT1DZYXHK8C0D50R
:title: How Nx 24.0.6 treats files outside a project and stores task results
:status: accepted
:supports: ADR-DECLARED-FILE-INPUTS
:supports: DES-INPUTS
:supports: DES-BUILD-INPUT-CHECK

Experiments on 13 November 2026 with the `nx` 24.0.6 package installed in this repository, linked into a throwaway git repository outside it, with Node.js 26.12.0 and git 2.56.0, and a reading of that package. Nx ran as `node node_modules/nx/dist/bin/nx.js` with `NX_DAEMON=false`, `NX_NO_CLOUD=true` and `NX_TUI=false`. The repository had two projects whose cached `build` target ran `echo` through `nx:run-commands`: `a`, with the inputs `{projectRoot}/**/*` and the runtime input `sha256sum shared/a.txt`, and `b`, with `{projectRoot}/**/*` and a fileset for `{workspaceRoot}/shared/b.txt`. Both files lay outside the projects' folders.

- **Affected.** `nx affected -t build --files=shared/a.txt,shared/b.txt` ran `b:build` only, and `nx affected -t build --files=shared/a.txt` ran no task. The runtime input still keyed the cache: `nx run a:build` was a cache hit twice in a row and a miss after `shared/a.txt` changed.
- **Outside the repository.** With a fileset for `{workspaceRoot}/../outside.txt` on `b`, Nx printed no error or warning, and `nx run b:build` was a cache hit after that file changed.
- **Ignored files.** With `gen/` in `.gitignore` and a fileset for `{workspaceRoot}/gen/g.txt`, `b:build` was a cache hit after the file changed. With `"includeIgnored": true` on the same fileset, it was a miss after the change and a hit on the next run. Yet `nx affected -t build --files=gen/g.txt` ran no task, and neither did `nx affected -t build --base=HEAD~1 --head=HEAD` after a commit that changed only `gen/g.txt`, added with `git add -f`. A third project `c` with an `includeIgnored` fileset for `nested/sub/h.txt`, a file that `nested/.gitignore` ignored, was selected both with `--files` and after a commit that changed only that file. With `nxig/` in a root `.nxignore`, a project with an `includeIgnored` fileset for `nxig/n.txt` missed the cache after that file changed, and `--files=nxig/n.txt` selected nothing. For `vendor/node_modules/f.txt`, which only Nx's fixed exclusion of `node_modules` folders covers, a project with such a fileset missed the cache after the change and was selected both with `--files` and after a commit that changed the file. As read in the source, Nx drops each changed file that the root `.gitignore` or `.nxignore` matches before it matches changed files against inputs, whatever the filesets say (`calculateFileChanges` in `project-graph/file-utils.js`, with `getIgnoreObject` in `utils/ignore.js`, which reads those two root files only).
- **Symbolic links.** In a second, clean repository that ignored `.nx`, project `h` declared `shared/alias.txt`, a symbolic link to `shared/data.txt`, and project `i` declared `shared/data.txt`, both without `includeIgnored`. After `data.txt` changed, `h` was a cache hit with the same `NX_TASK_HASH` as before, and `i` missed with a new one. A commit that changed only `data.txt` selected `i` and not `h`, while `--files=shared/alias.txt` selected `h`. In the first repository, a declared link's hash stayed the same after its destination changed, with and without `includeIgnored` and with the daemon, changed after `nx reset` and after `touch -h` on the link, and then reflected the destination's content: Nx hashes the destination when it first reads the link and keeps that hash until the link itself changes or `nx reset` clears it.
- **Failed tasks.** As read in the source, Nx stores a task's result only when the task is cacheable and its exit code is 0, unless `NX_CACHE_FAILURES` is `true` (`shouldCacheTaskResult` in `tasks-runner/task-orchestrator.js`). A fourth project `d` had a cached target whose command appended a line to a log and exited with 1. Run twice without the variable, it executed twice. Run twice with `NX_CACHE_FAILURES=true`, it executed once, and the second run exited with 1 without executing; after a change to an input file, it executed again. A batch executor reports a `TaskResult` per task, with `success` and an optional `status` of `success`, `failure` or `skipped`, and with nothing else that decides whether the result is stored (`config/misc-interfaces.d.ts`).
- **Recorded reads.** A target accepts an `ultracache` setting whose modes record the files a task reads and let the recording stand in for the declared inputs (`on`, the default), report undeclared reads (`warn`, and `error`, which behaves as `warn` for now), or record nothing (`off`). The typings call it Nx Cloud only and say that "nothing in the OSS runner records or applies IO" (`UltracacheMode` in `native/index.d.ts`, `ultracache/config.d.ts`).

The targets of the experiment ran no cargo. The points marked with a source file were read, not run.
:::

:::mara evidence EVD-NX-24-OPTION-SEMANTICS
:mid: 01M7AD4BCYERDMG40D5WH2XMAK
:title: What Nx 24.0.6 does with dependency inputs, target merges and its own flags
:status: accepted
:supports: DES-PLUGIN-OPTIONS
:supports: DES-INPUTS

An experiment and a reading of the `nx` 24.0.6 package installed in this repository, on 13 November 2026, with Node.js 26.12.0.

The experiment ran in a throwaway Git repository outside this one, with this repository's `node_modules` linked in. Its `nx.json` defined a named input `crate` as `["{projectRoot}/**/*"]`, and it had two projects with `project.json` files. Project `b` redefined `crate` with an `env` entry `B_NAMED` and a `runtime` entry `echo b-named`, and its `test` target had the inputs `crate`, `^crate`, `{ "env": "B_TARGET" }` and `{ "runtime": "echo b-target" }`. Project `a` had an implicit dependency on `b`, a file `a/docs/readme.md`, and a `test` target with the inputs `crate`, `^crate` and `!{projectRoot}/docs/**`. Nx's `HashPlanInspector` (`hasher/hash-plan-inspector.js`) listed the inputs of each task with `NX_DAEMON=false`. Then `nx run a:test --exclude-task-dependencies --output-style=static` ran with `NX_DAEMON=false` and a fresh `NX_CACHE_DIRECTORY`, after each change of a variable or file.

A second experiment, after the review of the option reference the same day, used rustc 1.100.0 and a throwaway workspace with a stand-in plugin, `stand-in`, that infers for each crate of a Cargo workspace a `test` target running `cargo test` with the input `{projectRoot}/**/*`, and a `probe` target whose executor records the options it receives. A crate's `project.json` laid targets over the inferred ones, which Nx merges with the same function as a plugin's own tables; projects were read back with `nx show project <name> --json`.

- **Inputs of a dependency.** The plan of `a:test` held `B_NAMED` and `echo b-named` from the named input of `b`, and neither `B_TARGET` nor `echo b-target` from the target of `b`. With `B_NAMED` changed, `a:test` ran again; with only `B_TARGET` changed, it was restored from the cache. The source splits a target's inputs the same way: entries of a named input that a `^` input names are hashed for each dependency, and the target's other entries for the task's own project only (`splitInputsIntoSelfAndDependencies` in `hasher/task-hasher.js`).
- **Negated patterns.** `a/docs/readme.md` was not in the plan of `a:test`, and a change to it was a cache hit. A negated pattern in a target's inputs takes out files that another entry of the same list brings in. In the second experiment a test of crate `a` compared `include_str!("../docs/value.txt")` with `1`, and the crate's `project.json` set the `inputs` of `test` to `["...", "!{projectRoot}/docs/**"]`. After `nx run a:test` passed and the file was changed to `2`, `nx run a:test` restored the passing result from the cache, while `cargo test -p a` in the workspace root failed with exit code 101. With `["..."]` alone, the same change made `nx run a:test` run and fail. An excluded file that a macro reads therefore gives a stale result.
- **`nx.json`.** `nx.json` was among the files of every task's plan, although no input named it.
- **Merging two configurations of one target.** `mergeTargetConfigurations` in `project-graph/utils/project-configuration/target-merging.js`, with `getMergeValueResult` and `mergeArrayValue` in `utils.js` beside it: a field that the later configuration sets replaces the earlier value; `options` and `configurations` are merged key by key; a list without the element `"..."` replaces the earlier list, and `"..."` stands for the earlier entries at its place. When both configurations name an executor and the executors differ, or both run `nx:run-commands` with different commands, the targets are incompatible (`isCompatibleTarget`): the later one is used in place of the earlier one, and the earlier options are discarded. A `command` becomes `nx:run-commands` with that command (`resolveCommandSyntacticSugar`). In the second experiment, a `probe` target in `project.json` with the inferred executor and an option `x` kept the inferred inputs and options and added `x`; with the executor `nx:noop`, or with a `command`, the target had no inputs left and only the options of `project.json`.
- **Nx's own flags.** In the second experiment each flag was passed to `nx run b:probe`, `nx run-many -t probe -p b` and `nx affected -t probe --files=<a file of b>`, and the probe recorded whether the option arrived. `--target`, `--configuration`, `--exclude` and `--parallel` never reached the executor, under any of the three commands, and `--runner=zzz` made all three fail. `--projects` reached it under `run` and `affected` but not under `run-many`, which selects projects with it, and `--project` reached it under `run-many` and `affected` but not under `run`, which takes it as the project to run (`command-line/yargs-utils/shared-options.js`). `--profile=release` reached it under all three: Nx switches its own task profiling on with the environment variable `NX_PROFILE` (`tasks-runner/run-command.js`), not with a flag. So did `--features`, `--allFeatures`, `--noDefaultFeatures`, `--targetTriple`, `--allTargets`, `--noDeps`, `--bin` and `--affectedTests`, the option names of [[DES-PLUGIN-OPTIONS]]. An option named `target`, `configuration`, `exclude`, `parallel` or `runner` could not be given on the command line at all.
- **`--verbose`.** All three commands consume `--verbose` as Nx's own flag: it is not among a task's overrides. Nx then supplies verbosity to the executor of a single task itself: it adds `verbose: true` to the options when the executor's schema declares a `verbose` property or sets `additionalProperties: true` (`applyVerbosity` in `utils/params.js`). In a third experiment on 13 November 2026, with a stand-in executor recording its options, `nx run`, `nx run-many` and `nx affected` with `--verbose` delivered `"verbose": true` under a schema with `additionalProperties: true` and under one that declares a boolean `verbose`, and no `verbose` under a schema that does neither. A batch implementation with the schema that declares `verbose` and `preferBatch` set received no `verbose` in its tasks' options under any of the three commands. In the same runs `--affectedTests=true` reached the executor under all three commands, as `true` among the options and as `"true"` among the task's overrides in the task graph, in a batch as well.
- **`env` of `nx:run-commands`.** That executor's `env` option holds "Environment variables that will be made available to the commands" (`executors/run-commands/schema.json`).

In the first experiment the projects came from `project.json` files, not from a plugin. That a plugin's named inputs are hashed in the same way is read from the source, where both reach the hasher as project configuration.
:::

:::mara evidence EVD-CARGO-NX-TABLES
:mid: 01M7AD4BCY1KGNGB0BSH140SNV
:title: How cargo 1.100.0 reports the nx tables of the option reference
:status: accepted
:supports: DES-PLUGIN-OPTIONS
:supports: DES-METADATA-TABLES

An experiment with cargo 1.100.0 and rustc 1.100.0 on 13 November 2026, with an empty Cargo home and `--offline`, in a throwaway workspace outside this repository. Its root `Cargo.toml` listed the members `crates/*` and excluded `tools/x`, and its `[workspace.metadata.nx]` table set `tags`, `namePrefix`, `envInputs` and a `project` sub-table with `name`. The member `api` set `name` and `implicitDependencies` in `[package.metadata.nx]`, `inputs = ["...", { env = "DATABASE_URL" }, "!{projectRoot}/docs/**"]` in `[package.metadata.nx.targets.test]`, and `affectedTests = false` and `features` among that target's options. The excluded crate `tools/x` had a `[workspace.metadata.nx]` table of its own with `testRunner`.

- `cargo metadata --format-version 1 --no-deps --offline` in the workspace root reported both tables as written: the `"..."` string, the inline table inside the list and the booleans kept their types and order, under `metadata.nx` of the workspace and of the package. A member without a table had `null` there.
- `cargo build --offline` built the workspace without a warning about any of the keys.
- In `tools/x`, the report named that folder as the workspace root, with one member and the crate's `[workspace.metadata.nx]` table as the workspace's metadata, and `cargo build --offline` built it. A standalone crate can therefore carry workspace settings in its own manifest.
:::

:::mara evidence EVD-CARGO-LOCKED-CHECK
:mid: 01M7AD4BCY0KKX34EHF23320MQ
:title: cargo metadata --locked fails on an outdated lockfile without changing it
:status: accepted
:supports: DES-INVOCATION

An experiment with cargo 1.100.0 on 13 November 2026, in the workspace of [[EVD-CARGO-NX-TABLES]] with two members and no registry dependencies, an empty Cargo home and `--offline`. After `cargo generate-lockfile`, a path dependency of `api` on `core` was added to `api`'s manifest, so that `Cargo.lock` was out of date.

- `cargo metadata --format-version 1 --no-deps --locked --offline` succeeded: the report that builds the graph does not notice an outdated lockfile.
- `cargo metadata --format-version 1 --locked --offline` exited with code 101 and the message "cannot update the lock file … because --locked was passed to prevent this". `Cargo.lock` was byte for byte unchanged.
- After `cargo generate-lockfile`, the same command succeeded.

`cargo metadata` without `--no-deps` resolves the dependencies, so in a workspace with registry dependencies it needs what the full report needs, the registry or a filled Cargo home ([[EVD-CARGO-NO-DEPS]]). That case was not run here.
:::

:::mara evidence EVD-NX-PLUGIN-ENTRIES
:mid: 01M7ABYX5EADNXFRHAA2F17VBK
:title: How Nx 24.0.6 runs several entries of one plugin
:status: accepted
:supports: DES-METADATA-REPORT

A reading of the `nx` 24.0.6 package and an experiment on 13 November 2026 with cargo 1.100.0 and Node 26.12.0 on Linux. The experiment ran through the plugin's own tests (`nx-rust/test/discovery.spec.ts`), which list a stand-in that behaves as the plugin twice in `nx.json`, with `include` filters that split the manifests between the two entries, and build the graph with plugin isolation on and off.

- **Isolation on**, Nx's default: Nx starts one plugin worker per entry, keyed by the plugin, the workspace root and the entry's position in `nx.json` (`project-graph/plugins/isolation/load-isolated-plugin.js`). Two entries of one plugin run in two processes and share nothing.
- **Isolation off** (`NX_ISOLATE_PLUGINS=false`): Nx loads the plugin module once per process with `require` and gives each entry a shallow copy of its exports (`plugins/load-resolved-plugin.js`), so a module-level variable is shared by all entries. An entry without `options` passes `undefined` to both hooks, so their arguments do not tell entries apart. Nx calls `createDependencies` as a method of the entry's copy and the `createNodes` function as a member of the pair it read from that copy (`plugins/loaded-nx-plugin.js`).
- **Order.** Nx starts the `createNodes` calls of all entries of one computation one after another in a single synchronous loop, and calls `createDependencies` once all of them have settled, also when one of them failed (`utils/project-configuration-utils.js`, `project-graph.js`).
- **Measured.** With a workspace's root manifest given to one entry and its members to the other, the workspace was reported twice with isolation on, once in each worker. With isolation off it was reported once, when the second entry reused the report that the first had requested in the same computation. The version of the plugin reviewed on 13 November 2026 kept the result of `createNodes` in one module-level variable: with isolation off, both entries' `createDependencies` then received the discovery of the second entry.

The plugin therefore makes each entry's copy carry a `createNodes` of its own and finds the entry in `createDependencies` through that copy. These are Nx internals, which the tests check in both modes and which have to be checked again for another Nx major.
:::

:::mara evidence EVD-NX-EDGE-CACHE
:mid: 01M7AE241Y0VGGYCNWWR01WR7T
:title: How Nx 24.0.6 keeps a plugin's edges from one graph to the next
:status: accepted
:supports: DES-PROJECT-GRAPH

A reading of the `nx` 24.0.6 package and experiments on 13 November 2026 with cargo 1.100.0 and Node 26.12.0 on Linux: the review of pull request #17 ran the plugin through real Nx with the daemon on and off, and runs through the plugin's test harness (`nx-rust/test/harness`), with the edge type switched by a temporary change, repeated the first case below and tried one alternative. The source files named are in `nx/dist/src`.

- **Source files.** An edge of the type `static` or `dynamic` names a source file, which Nx accepts when it is a file of the source project or one of the files that belong to no project: the review saw `nx.json` accepted, and another project's manifest and a file that does not exist rejected (`getFileData` in `project-graph/project-graph-builder.js`). Nx records such an edge in the data of that file, and then builds the `static` and `dynamic` edges of each project from its files' records. An `implicit` edge names no file and is kept as the plugin returned it (`getUpdatedProjectGraph` and `calculateAlreadySetTargetDeps` there). `dynamic` behaves as `static` throughout.
- **Reuse.** Nx caches the records by project name, file path and file hash. After the plugins' `createDependencies`, it puts the cached records of each file whose project, path and hash are unchanged in place of the records just made for it, and it does so only where the cache holds records for that file (`extractCachedFileData` and `processProjectNode` in `project-graph/nx-deps-cache.js`, `buildProjectGraphUsingContext` in `project-graph/build-project-graph.js`).
- **Invalidation.** Nx discards the whole cache when its format or the Nx version changed, when a project name of the previous graph is gone, when an existing TypeScript path mapping changed, when the name, version or `options` of a plugin entry changed, when `pluginsConfig` changed, or when the hash of the external nodes changed (`shouldRecomputeWholeGraph` in `project-graph/nx-deps-cache.js`). A new project does not discard it, and neither does a change to a plugin entry's `include` or `exclude`, which the comparison leaves out (`getNxJsonPluginsData`).
- **Measured.** The review created the graph of a fixture twice, with one change between the two, once with the plugin's edges returned as `static`, once as `dynamic`, each naming the manifest of its source project, and once as `implicit`, with the Nx daemon on and off. The outcomes were the same with and without the daemon. "Wrong" means an edge that was missing or still pointed at the old target:

  | Change between the two graphs                        | `static` or `dynamic` | `implicit` |
  | ---------------------------------------------------- | --------------------- | ---------- |
  | A crate removed from `.nxignore`                     | wrong                 | right      |
  | A crate removed from `.gitignore`                    | wrong                 | right      |
  | The plugin entry's `exclude` removed                 | wrong                 | right      |
  | The plugin entry's `include` widened                 | wrong                 | right      |
  | A new member under an unchanged `members` glob       | wrong                 | right      |
  | A `[workspace.dependencies]` entry retargeted        | wrong                 | right      |
  | A project renamed through `project.json`             | right                 | right      |
  | Only the version requirement of a dependency changed | right                 | right      |

  The runs through the harness repeated the first row without the daemon in `subfolder-workspace`: with `static` and with `dynamic` edges, the second graph had no edge from `api` or `rust` to `testkit`, although `createDependencies` returned both, and with `implicit` edges both were there. The test "adds an edge when a crate gets a project and no manifest changes" in `nx-rust/test/graph.spec.ts` keeps this case.

- **Alternatives.** Another source file, such as the workspace's root manifest or its lockfile, fails in the same way, because the edges still depend on other files. A file that belongs to no project, such as `nx.json`, is reused by its hash in the same way, and Nx keeps only one edge per target and type in such a file's records: in a run through the harness with `nx.json` as the source file of every edge, the first graph of `subfolder-workspace` already lacked the edges from `rust` to `codegen` and to `model`, two crates that `api` depends on as well. `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false` turns the reuse off, but for every plugin and the whole graph, each user has to set both on every command, and the second variable has no effect while the daemon runs (`project-graph/project-graph.js`). Nx 24.0.6 offers a plugin no way to discard its own part of the cache.
- **Other readers of the type.** Nx's task graph, `affected` and the task hasher follow edges of every type. In the rest of the `nx` package, leaving out the graph viewer and the JS plugin, which were not read, only Nx release tells the types apart: the default `readDependencies` of its `VersionActions` leaves out `implicit` edges, and an implementation can override it (`command-line/release/version/version-actions.js`). In `@nx/eslint-plugin` 24.0.6, read and not run, the rule `enforce-module-boundaries` follows edges of every type when it looks for circular dependencies, for projects reachable under tag constraints and for transitive external dependencies (`buildMatrix` in `dist/src/utils/graph-utils.js`). It reads the type only to find lazy-loaded imports, from `dynamic` edges (`hasDynamicImport` in `dist/src/utils/runtime-lint-utils.js`), and it names the files along a circular path from the files' records, which hold nothing for an `implicit` edge (`findFilesInCircularPath`).

A crate's edges depend on more than its own manifest: on the `[workspace.dependencies]` of its workspace's root manifest, on the ignore files and the plugin entry's options, which decide which crates are projects, and on the members that a glob matches. The plugin therefore returns its edges as `implicit`, and Nx recomputes them on every graph computation. These are Nx internals, to be checked again for another Nx major.
:::

:::mara evidence EVD-NEXTEST-CARGO-FLAGS
:mid: 01M7AH88BCFA99QFV4EGE16JHW
:title: cargo-nextest takes the Cargo profile as --cargo-profile
:status: accepted
:supports: DES-PLUGIN-OPTIONS

An experiment on 13 November 2026 with cargo-nextest 0.9.151, the prebuilt binary from `https://get.nexte.st/latest/linux`, and cargo and rustc 1.100.0, in a throwaway crate with a unit test, a doctest, a feature `extra` and a Cargo profile `custom` that inherits from `dev`. No `.config/nextest.toml` existed.

- `cargo nextest run --profile custom` failed with exit code 96 and "profile `custom` not found (known profiles: default, default-miri)": nextest reads `--profile` as a profile of its own configuration.
- `cargo nextest run --cargo-profile custom` built with Cargo's profile `custom`, into `target/custom`, and ran the test under nextest's profile `default`.
- `cargo test --doc --profile custom` built with the profile `custom` and ran the doctest.
- `cargo nextest run` accepted `--features`, `--all-features`, `--no-default-features` and `--target` as cargo does; its help lists them beside `--cargo-profile`.
:::

:::mara evidence EVD-NX-24-ENTRY-CONTEXT
:mid: 01M7AH88BCK4ZK4JY2X0N7C9C0
:title: What each entry of a plugin sees of the others in Nx 24.0.6
:status: accepted
:supports: DES-PLUGIN-OPTIONS

An experiment on 13 November 2026 with `nx` 24.0.6 and Node.js 26.12.0, in a throwaway Git repository outside this one. A Cargo workspace in `rust/` had the members `a`, `b` and `hidden`, and `.nxignore` named `rust/crates/hidden`. `nx.json` listed a stand-in plugin twice: one entry with `include` set to `rust/Cargo.toml` and `rust/crates/a/**` and the option `testRunner` set to `cargo`, the other with `include` set to `rust/crates/b/**` and `rust/crates/hidden/**` and `testRunner` set to `nextest`. The stand-in's `createNodes` for `**/Cargo.toml` recorded the files it received, the `plugins` of `context.nxJsonConfiguration`, and, for every entry naming the stand-in, the result of `findMatchingConfigFiles` applied with that entry's `include` and `exclude` to the output of `globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"])`. `nx show projects` ran with plugin isolation on (the default), with `NX_ISOLATE_PLUGINS=false`, and with the Nx daemon on.

- **Every entry sees all.** In every mode both entries' contexts held both entries of `plugins`, with their `include` patterns and options. With isolation on, and with the daemon, the two entries ran in two processes; with isolation off, in one.
- **Nx's assignment can be recomputed.** For each entry, applying its own `include` and `exclude` to the files of the workspace context gave exactly the files that Nx handed to it, also leaving out the manifest under the `.nxignore` path that the second entry's `include` matched. So each entry can tell which entries receive manifests of a workspace, and with which options.
- **Source.** Nx passes the whole `nx.json` as `nxJsonConfiguration` to each entry's `createNodes` and chooses its files with `findMatchingConfigFiles(files, include, exclude)` (`project-graph/utils/project-configuration-utils.js`). Both that function and `globWithWorkspaceContext` are exported from `nx/src/devkit-internals` only, an interface that can change between majors ([[RISK-UPSTREAM-CHANGES]]).

The stand-in was not the plugin; how the plugin's two entries share reports is [[EVD-NX-PLUGIN-ENTRIES]].
:::

:::mara evidence EVD-CARGO-REDIRECTIONS
:mid: 01M7AQ4FBNBJZK6DKFSMS2793S
:title: What cargo does with [patch], [replace] and paths, and what the plugin can see of them
:status: accepted
:supports: ADR-REDIRECTION-EDGES

Experiments on 13 November 2026 with cargo 1.100.0, the main cases repeated with 1.91.0, on Linux, and a reading of the `nx` 24.0.6 package. Each experiment ran in a throwaway repository with a `CARGO_HOME` of its own, in which `[source.crates-io] replace-with` replaced crates.io by a local registry, a `file://` git index holding `model 0.1.0` and `wrapper 0.1.0`, which depends on `model ^0.1`. The workspace had the members `api`, with `model = "0.1"`, `viaw`, with `wrapper = "0.1"`, and `model 0.1.5`. The commands were `cargo metadata --format-version 1 --no-deps --offline`, `cargo metadata --format-version 1 --offline` with and without `--locked`, `cargo tree --offline -e normal,build,dev` and `cargo generate-lockfile`, and `Cargo.lock` was read after each. Both versions gave the same results except for `include`.

- **The graph's report shows nothing.** With `[patch.crates-io] model = { path = "crates/model" }` in the root manifest, the `--no-deps` report listed `api`'s dependency with the crates.io source and no `path`, and was identical to the report without the patch. So it was for every way of redirecting below, and with a patch path that does not exist the report still succeeded. The full report and `cargo tree` named the local crate, and `Cargo.lock` held it as an entry without `source` and without its folder.
- **Where cargo reads them.** From the workspace's root manifest, `[patch]` entries with a `path`, for crates.io, for a registry named in `[registries]` and for a git URL, and `[replace]` entries with a `path`; cargo rejects a manifest that has both tables. A `[patch]` in a member's manifest is ignored, with the warning "patch for the non root package will be ignored", which `--no-deps` prints too. From `.cargo/config.toml`, and the older `.cargo/config`, in the folder cargo starts in and in each folder above it, from `config.toml` in the Cargo home, and from `--config`: `[patch]` entries and `paths`. A relative path in such a file resolves against the folder above the one that holds the file: the folder that holds `.cargo`, the one that holds the Cargo home, and for a file that `include` names, the folder above that file's folder. Cargo 1.100.0 applied a `[patch]` from an included file, in the plain and in the `{ path = … }` form; 1.91.0 ignored it. Started outside the workspace with `--manifest-path`, cargo did not read the workspace's `.cargo/config.toml`. `CARGO_PATCH_CRATES_IO_MODEL_PATH` had no effect. A `[patch]` or `[replace]` path has to be the crate's own folder, while `paths = ["local"]` took `model` from `local/inner/model`.
- **Who uses the crate.** `viaw` was built with the local `model` through `wrapper` alone, which `--no-deps` shows only as `viaw → wrapper`. A crate `m` whose workspace has the patch and that depends by path on `l`, a member of another workspace that declares `model = "0.1"`, was built with the local `model` through `l`; `l` built in its own workspace got the registry's. A redirection applies to everything cargo builds for the workspace that has it.
- **Whether it is used.** A patch whose version does not satisfy the requirement, 0.2.0 for `^0.1`, and a patch to 0.1.5 added after `Cargo.lock` had locked the registry's 0.1.0, were not used until `cargo update`: without a message where the patched crate is a member, otherwise with "patch … was not used in the crate graph" and a `[[patch.unused]]` entry in the lockfile. A patch of the locked version was used at once. `paths` put the local 0.1.5 in place of the locked 0.1.0 and left no trace in `Cargo.lock`; `[replace]` added `replace = "model 0.1.0"` to the registry's entry.
- **What resolving costs.** The full report and `cargo tree` failed offline until every package had been downloaded ("failed to download `wrapper`"), and for a git dependency until the git source had been fetched, although it was patched. Without `--locked` they created a missing `Cargo.lock` and rewrote a stale one, also when they failed afterwards; with `--locked` they failed on either.
- **Configuration files and `include`.** With both `.cargo/config` and `.cargo/config.toml` in one folder, Cargo 1.91.0 and 1.100.0 read only `config`, with the warning "both … exist. Using … config", and an unparsable `config.toml` beside it stopped neither. An `include` of an unparsable file stopped `cargo metadata --no-deps` with 1.100.0 and not with 1.91.0, which ignores `include`.
- **A crate that cargo builds but does not report.** In a workspace with `members = ["api"]` whose root manifest patches `model` to `local`, a folder inside the workspace's folder holding `model` without `[workspace]`, `cargo check` succeeded, while `cargo metadata --no-deps --manifest-path local/Cargo.toml` and `cargo read-manifest` failed on both versions with "current package believes it's in a workspace when it's not"; `cargo locate-project` succeeded but names only the manifest.
- **Version requirements.** For 43 pairs of a requirement and a local version, of every form the plugin evaluates (bare, `^`, `~`, `=`, `>`, `>=`, `<`, `<=`, comma-joined, `*`, `1.*`, `1.2.*`, and a version with build metadata), a dependency patched to the local crate resolved with an empty Cargo home and offline exactly when the version satisfied the requirement, on both versions (`nx-rust/test/version-req.spec.ts`).
- **Vendoring.** After `cargo vendor` into the workspace with `[source]` replacement, every report showed the registry as the source, cargo refused to build an edited vendored file because its checksum changed, and `cargo metadata --no-deps` in a vendored crate's folder failed with "current package believes it's in a workspace when it's not".
- **Nx.** In `nx` 24.0.6, the daemon subscribes to changes below the repository root (`subscribeToWorkspaceChanges` in `daemon/server/server.js`) and runs every plugin's `createNodes` again after any such change (`processFilesAndCreateAndSerializeProjectGraph` in `daemon/server/project-graph-incremental-recomputation.js`); without the daemon, every command does (`project-graph/project-graph.js`). A change to a file outside the repository reaches a daemon's graph only with the next change inside it.

The fixture `patched-workspaces` keeps the cases that need no registry, and `nx-rust/test/redirections.spec.ts` checks with `cargo tree --offline --locked` that every crate with a project that cargo builds for a member is reachable from it in the graph. The workspaces were toys, so this says nothing about how long reading the files takes in a large repository.
:::

:::mara evidence EVD-NX-24-INPUTS-OUTPUTS
:mid: 01M7AT8XZ93BXDYFHRTR7WF434
:title: What Nx 24.0.6 does with the plugin's inputs, outputs and dotenv files
:status: accepted
:supports: DES-INPUTS
:supports: DES-OUTPUTS
:supports: DES-DIAGNOSTICS

Experiments on 13 November 2026 with the `nx` 24.0.6 package that this repository installs, cargo and rustc 1.100.0, Node 26.12.0 and rustup 1.29.3, on Linux x86-64, through the cache-key harness of `nx-rust/test` (`nx-rust/test/README.md`): in a copy of a fixture, Nx's own `createProjectGraphAsync`, `createTaskGraph` and task hasher built the graph and the task hashes with `NX_DAEMON=false`, `RUSTUP_AUTO_INSTALL=0` and the plugin loaded from source. A reading of that package went with them; paths below are under `dist/src/`, and a point marked "read" was not run.

- **A named input that a dependency lacks.** A crate whose `project.json` gave it an implicit dependency on a JS project, its own named input `cargoCrate`, and the inputs `cargoCrate` and `^cargoCrate` on a target, failed the hash with `Input 'cargoCrate' is not defined`. Nx expands a `^` input with the named inputs of each project that the task's project depends on, and those are Nx's own `default`, `{projectRoot}/**/*`, then those of `nx.json`, then the project's own (`getNamedInputs` and `expandNamedInput` in `hasher/task-hasher.js`, read). Every project therefore has a `default`.
- **Executors.** Hashing a task looks up its executor in every case, for a custom hasher (`getCustomHasher` in `tasks-runner/utils.js`, called from `hasher/hash-task.js`). A target whose executor's package declares no executors failed the hash with `Unable to resolve @convesoft/nx-rust:cargo. The "@convesoft/nx-rust" package does not support Nx executors.` `nx show target inputs` takes that failure as "no custom hasher" and lists the inputs (`hasCustomHasher` in `command-line/show/show-target/utils.js`, read).
- **Outputs.** `getOutputsForTargetAndConfiguration` (`tasks-runner/utils.js`) interpolates an output from the task's options, with the tokens of `tasks-runner/tokens.js`, in which `{options.a ?? b}` falls back to the literal `b` when the option has no value, and then normalises the path. Called directly, `{workspaceRoot}/rust/target/{options.targetTriple ?? .}/{options.profile ?? debug}/api` gave `rust/target/debug/api` without options, `rust/target/release/api` with `profile: "release"`, and `rust/target/x86_64-unknown-linux-gnu/release/api` with that `targetTriple` as well. An output whose `{options.…}` token keeps no value is dropped, and a target named `build` without `outputs` gets `dist/{projectRoot}`, `{projectRoot}/dist`, `{projectRoot}/build` and `{projectRoot}/public` (read).
- **A task's dotenv files.** `getTaskSpecificEnv` (`tasks-runner/task-env.js`) loads the dotenv files of a task only when `NX_LOAD_DOT_ENV_FILES` is `true`, which `nx run`, `nx run-many` and `nx affected` set unless it is `false` (`setEnvVarsBasedOnArgs` in `tasks-runner/run-command.js`, read). With the variable set, `RUSTUP_TOOLCHAIN=1.91.0` in a crate's `.env`, which `.gitignore` listed, changed the keys of that crate's tasks and of no other crate of its workspace, and a toolchain name that rustup cannot have gave a new key at each hash while the keys of the other crates stayed the same. Without the variable, as the harness first hashed, neither changed a key.
- **The toolchain of one workspace.** With a `rustc` first on `PATH` that printed a value of its own in the folder `backend` and ran the real `rustc` elsewhere, a new value changed the keys of the crate in `backend` and not those of the crate in `shared` that it depends on. The command `cd './backend' && RUSTUP_AUTO_INSTALL=0 rustc -Vv 2>/dev/null || od -An -N16 -tx1 /dev/urandom` thus ran per task, in the folder it names.
- **npm nodes from a pnpm lockfile.** With a root `package.json` and a `pnpm-lock.yaml` in pnpm 9's format written by hand, Nx's JS plugin made an npm node of each package listed, `npm:@convesoft/nx-rust` among them, and `externalDependencies: ["@convesoft/nx-rust"]` hashed that node and `npm:tslib@2.9.1` behind it: a new integrity of `tslib` changed the key, one of `left-pad` did not. Without `node_modules/.modules.yaml`, which a pnpm install writes, graph creation failed with "pnpm lockfile detected, but … node_modules/.modules.yaml is missing" (`plugins/js/lock-file/utils/pnpm-normalizer.js`).
- **Files that Nx sees.** `globWithWorkspaceContext` (`utils/workspace-context.js`), which Nx's own plugins call in `createNodes`, returned the manifest of a path dependency only while no `.gitignore` listed its folder; it asks the daemon where one serves the command (read).

No executor of the plugin ran: this shows what Nx hashes and declares for targets of this shape, not what a run stores or restores.
:::

## Sources

Pages and repositories read for the design discussion, on 12 November 2026.

- [eddacraft/nxrust](https://github.com/eddacraft/nxrust): `docs/product-spec.md`, the cache design document, `src/graph.ts`, `src/utils/cache-inputs.ts`, `plans/issues.md`, `plans/modules/10-wasm-napi.aps.md`
- [max-sixty/cargo-affected](https://github.com/max-sixty/cargo-affected): README, `docs/report-json.md`, architecture notes
- [nrwl/nx](https://github.com/nrwl/nx) source at main: `misc-interfaces.ts`, `tasks-schedule.ts`, `tasks-runner/utils.ts`
- [Nx: Add Language Support to Nx](https://nx.dev/docs/kb/add-language-support.md)
- [Nx 23.3 release post](https://nx.dev/blog/nx-23-3-release): task-based affected, batched oxlint executor
- [Nx batch parallelism repro](https://github.com/ineentho/nx-batch-parallelism-repro)
- [@monodon/rust 3.0.0 release](https://github.com/Cammisuli/monodon/releases/tag/rust-3.0.0)
- [Cargo build cache reference](https://doc.rust-lang.org/beta/cargo/reference/build-cache.html): build-dir and target-dir
- [Call for Testing: Build Dir Layout v2](https://blog.rust-lang.org/2026/03/13/call-for-testing-build-dir-layout-v2)
- [Rework Cargo Build Dir Layout](https://goals.rust-lang.org/2025h2/cargo-build-dir-layout.html): build cache locking
- [Cargo unstable features](https://doc.rust-lang.org/cargo/reference/unstable.html): feature-unification
- [cargo-hakari: about workspace-hack crates](https://docs.rs/cargo-hakari/latest/cargo_hakari/about/index.html)
- [nextest filterset reference](https://nexte.st/docs/filtersets/reference/)
- [nextest: archiving and reusing builds](https://nexte.st/docs/ci-features/archiving/)
- [Sunsetting the rustwasm GitHub org](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org)
- [napi-rs: cross build](https://napi.rs/docs/cross-build)
