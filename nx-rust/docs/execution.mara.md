# Batching and features

> **Status:** specified, not implemented yet. Planned for milestone 0.2. Until
> then each task runs its own cargo command.

Nx schedules one task per crate. Running each as its own cargo process would
queue them behind Cargo's build lock and repeat work. The plugin instead runs
them as **one cargo call per group** and reports a result for every crate.

```sh
nx run-many -t test
```

```text
Nx tasks                       cargo calls
  api:test   ┐
  core:test  ├─ rust/, default features, dev profile, host   ->  1 call
  cli:test   ┘
  xtask:test ── tools/xtask/ (standalone crate)             ->  1 call
```

You do not pass a flag for this. Nx still hashes, restores and stores each task
on its own, so a cache hit for `core:test` simply leaves `core` out of the
call.

## What forms a group

A group is the tasks of one kind, such as `test` or `lint`, in one Cargo
workspace whose cargo commands would differ only in the crates they select: one
feature set, profile and target triple, and the same target options, such as a
crate's switch for `--all-targets`. Tasks in one group share one cargo
invocation. Tasks that differ in any of these run separately, one group after
another. So do tasks whose `.env` files, such as one in a crate's folder, give
them different environment variables: each cargo call runs with the environment
its tasks were keyed with.

Known limit: while a batch runs, Nx starts no other task. In a mixed repository
JS tasks wait for the Rust batch ([[RISK-BATCH-BEHAVIOUR]]).

## When something fails

Cargo is told to keep going after an error, so one broken crate does not hide
the results of the others.

- A task fails when its own crate fails, or when a crate it depends on does not
  compile.
- Every other task of the same cargo call still gets its own result.
- Under `workspace-build`, cargo also compiles crates you did not ask for. If
  one of those fails and nothing you asked for depends on it, you get a
  warning, and no task fails.

## Feature unification

Cargo merges the features of shared dependencies across whichever crates are
built together. If the plugin simply built "whatever is affected", that set
would change on every run: dependencies would be rebuilt again and again, and a
crate's result would depend on what else happened to be in its batch.

The plugin therefore always resolves features for the **whole workspace**, with
one of three strategies:

| Strategy          | Used when                                      | How                                                                               | Cost                                                     |
| ----------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `hakari`          | The workspace has a cargo-hakari configuration | Build only the selected crates; the hack crate keeps third-party features unified | The hack crate must be kept current                      |
| `cargo`           | You opt in; experimental                       | Cargo's `resolver.feature-unification = "workspace"`                              | Needs a nightly flag until Cargo stabilises it           |
| `workspace-build` | Fallback                                       | Build the whole workspace, then filter which tests run                            | Compiles unaffected crates; needs a warm build directory |

To choose a strategy yourself, set `featureUnification` in
`[workspace.metadata.nx]` of one workspace, or in the plugin options for all of
them ([Configuration](configuration.mara.md#all-settings)).

With `hakari`, the plugin adds what hakari alone does not cover:

- If one workspace member switches on a feature of another member, the plugin
  detects that and uses `workspace-build` for that workspace.
- A crate can stop declaring a feature it needs because the hack crate enables
  it. An optional strict per-crate build check catches this.
- A cached workspace-level check fails early when the hack crate is stale.

## Feature sets and target triples

- Feature sets are Nx configurations at workspace level: the default features
  and all features.

  ```sh
  nx run-many -t test                     # default features
  nx run-many -t test -c all-features
  ```

- A crate that needs something else names it as `crate/feature`, or forms its
  own group.
- A platform triple for the same kind of artifact is a flag. A different kind
  of artifact, such as wasm or a Node addon, gets its own target
  ([napi and wasm artifacts](artifacts.mara.md)).
- v1 runs tests on the host triple only.

## Requirements

:::mara requirement REQ-BATCHING
:mid: 01M78FHG7FRS15ZD38BR42JSK7
:title: Run a group of tasks as one cargo invocation
:status: accepted
:satisfies: NEED-EFFICIENT-BUILDS

Tasks of one [[TERM-GROUP]] that Nx runs in the same command are served by a single cargo invocation, without the user passing a flag. Each task still has its own result, its own terminal output and its own cache entry, and a task restored from the cache takes no part in the invocation. A task fails only when its own crate fails or a crate it depends on fails; a failure elsewhere in the invocation does not fail it. Tasks whose invocations would differ in more than the crates they select never share one.
:::

:::mara requirement REQ-STABLE-FEATURES
:mid: 01M78FHG7FNYQZJD8HRKA23YRY
:title: Make a crate's result independent of its batch
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-EFFICIENT-BUILDS

The features with which a crate and its dependencies are compiled do not depend on which other crates run in the same Nx command. Two runs that select different sets of crates from one workspace compile shared dependencies with the same features, so neither run rebuilds what the other built, and a cached result is valid whatever ran beside it.
:::

## Design

:::mara design DES-BATCH
:mid: 01M78FHG7FY1VKFFHZ8G4WFDBJ
:title: Batch executor
:status: accepted
:satisfies: REQ-BATCHING
:mitigates: RISK-NX-INPUT-SEMANTICS

The plugin's cargo executor declares a `batchImplementation` and `preferBatch: true` in `executors.json`. Nx then hands the executor all runnable tasks of that executor at once, without `--batch`, and still hashes, restores and caches each task individually ([[ADR-BATCH-EXECUTOR]]).

The batch implementation splits its tasks into groups ([[TERM-GROUP]]): tasks share a group only when their cargo invocations would differ in nothing but the crates they select. A group has one kind of task, Cargo workspace, feature set, profile, target triple and set of command options, and one environment, as the next paragraph describes. It runs the groups one after another, because each cargo call already uses every core and the groups of one workspace share a build lock. Each group is one cargo call, started in the workspace root ([[DES-INVOCATION]]), that selects the crates of the group's tasks as [[DES-UNIFICATION]] prescribes.

Nx computes each task's key with that task's environment, which includes the dotenv files it loads for the task: those in the crate's folder and those at the repository root named for the target or a configuration, such as `.env.test`. The batch process gets only the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` ([[EVD-NX-24-INPUT-SEMANTICS]]). The batch implementation therefore rebuilds each task's environment from the same files, in the order Nx reads them, splits a group further where those environments differ, and runs each cargo call with the environment of its tasks. No task runs with another environment than the one its key was computed with.

Cargo is told to continue after a failure: `--keep-going` for builds, checks and clippy, and `--no-fail-fast` for test runs. The plugin maps cargo's output back to one result per task. A task fails when its own crate fails, or when a crate it depends on fails to compile. A failure in a crate that a task does not depend on does not fail it. When that crate is outside the selection, which can happen under `workspace-build`, the failure is reported as a warning and fails no task.

Known issue: since Nx 22.7, no other task starts while a batch runs, so JS tasks wait for a Rust batch ([[RISK-BATCH-BEHAVIOUR]]).
:::

:::mara design DES-UNIFICATION
:mid: 01M78FHG7F43VP2172VYY8A41Q
:title: Feature unification strategies
:status: accepted
:satisfies: REQ-STABLE-FEATURES

Features are always resolved for the whole workspace, never for the set of crates that happens to be selected ([[ADR-WORKSPACE-FEATURES]]). One option chooses how:

| Strategy          | Used when                                      | How                                                                                        | Cost                                                     |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `hakari`          | The workspace has a cargo-hakari configuration | Build only the selected crates; the [[TERM-HACK-CRATE]] keeps third-party features unified | The hack crate must be kept current                      |
| `cargo`           | Opted in; experimental                         | `resolver.feature-unification = "workspace"`                                               | Needs a nightly flag until Cargo stabilises it           |
| `workspace-build` | Fallback                                       | Build the whole workspace and filter which tests run                                       | Compiles unaffected crates; needs a warm build directory |

The `hakari` strategy adds four things to what hakari does:

- **Features between workspace crates.** When one member enables a feature of another member, which the `cargo metadata` report shows, the plugin falls back to `workspace-build` for that workspace.
- **Masked missing features.** A crate can stop declaring a feature it needs because the hack crate enables it. An optional strict per-crate build target catches this.
- **Drift.** A cached workspace-level check fails early when the hack crate is stale.
- **Publishing.** The release flow has to handle the dependency on the hack crate ([[REQ-RELEASE]]).

Whether hakari unifies features between workspace crates is not confirmed ([[RISK-HAKARI-GAPS]]).
:::

:::mara design DES-FEATURE-SETS
:mid: 01M78FHG7FBXD8XDCTFPZQD2QA
:title: Feature sets and target triples
:status: accepted
:satisfies: REQ-BATCHING
:satisfies: REQ-STABLE-FEATURES

Feature sets are Nx configurations at workspace level: the default features and all features. A crate that needs another set either names single features as `crate/feature` or forms its own group. Because features are target options, Nx hashes them ([[DES-INPUTS]]).

A platform triple for the same kind of artifact is an option of the target, `targetTriple` ([[DES-PLUGIN-OPTIONS]]). Without it, `build.target` in Cargo's configuration or `CARGO_BUILD_TARGET` can pick triples, and the outputs follow them ([[DES-OUTPUTS]]). A different kind of artifact gets its own named target ([[ADR-ARTIFACT-TARGET-NAMES]]). A non-host triple is a group of its own and builds only the selected crates, because building a whole workspace for such a triple would include crates that cannot target it. v1 runs tests on the host triple only.
:::
