# Batching and features

> **Status:** specified, not implemented yet. Planned for milestone 0.2. Until
> then each task runs its own cargo command.

Nx schedules one task per crate. Running each as its own cargo process would
queue them behind Cargo's build lock and repeat work. The plugin instead runs
each group of them with **one cargo call**, not one per crate, and reports a
result for every crate. `test` with nextest needs one more call for the
doctests, and in affected mode one before it for the selection of tests
([Testing](testing.mara.md)).

```sh
nx run-many -t test
```

```text
Nx tasks                       cargo calls
  api:test   ┐
  core:test  ├─ rust/, default features, dev profile, host   ->  1 call
  cli:test   ┘
  xtask:test ── tools/xtask/ (standalone crate)             ->  1 call

With nextest, each group takes 2 calls (tests, doctests), 3 in affected mode.
```

You do not pass a flag for this. Nx still hashes, restores and stores each task
on its own, so a cache hit for `core:test` simply leaves `core` out of the
group.

## What forms a group

A group is the tasks of one kind, such as `test` or `lint`, in one Cargo
workspace whose cargo commands would differ only in the crates they select: one
feature set, profile and target triple, and the same target options, such as a
crate's switch for `--all-targets`. Tasks that differ in any of these run
separately, one group after another. So do tasks whose `.env` files, such as
one in a crate's folder, give them different environment variables: each cargo
call runs with the environment its tasks were keyed with.

Tasks in one group share their cargo calls: one for most targets, and with
nextest one for the tests, one for the doctests and, in affected mode, one for
the selection before them. Every call of a group selects its crates the same
way, so they all compile with the same features
([Feature unification](#feature-unification)).

Known limit: while a batch runs, Nx starts no other task. In a mixed repository
JS tasks wait for the Rust batch ([[RISK-BATCH-BEHAVIOUR]]).

## When something fails

A task is reported successful only when cargo's output shows that its crate
passed.

- A task fails when its own crate fails in any of its group's cargo calls, the
  doctests included, or when a crate it depends on does not compile.
- `build`, `check` and `lint` keep going after an error, so every task whose
  crate does not need the broken one still gets its own result.
- Under `workspace-build`, cargo also compiles crates you did not ask for. If
  one of those fails in a `build`, `check` or `lint` run and nothing you asked
  for depends on it, you get a warning, and no task fails.
- A failing test does not stop the others, so every other `test` task of the
  group still gets its own result.
- A compile error stops a test run before any test runs, because cargo cannot
  keep going there. Every `test` task of the group then fails, and the message
  names the crate that did not compile and says that the other crates' tests
  were not run. This is a cost of batching: when each task runs its own cargo
  command, as in milestone 0.1, an unrelated crate's tests still pass.

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
:title: Run a group of tasks with one cargo command per step
:status: accepted
:satisfies: NEED-EFFICIENT-BUILDS

Tasks of one [[TERM-GROUP]] that Nx runs in the same command are served together, without the user passing a flag: with one cargo command for each step of their target, so that the number of cargo commands depends on the target and not on how many tasks the group has. Each task still has its own result, its own terminal output and its own cache entry, and a task restored from the cache takes no part in the commands. A task fails only when its own crate fails in any step, or a crate it depends on fails; a failure elsewhere in the group does not fail it. Tasks whose commands would differ in more than the crates they select are never served together.
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

The batch implementation splits its tasks into groups ([[TERM-GROUP]]): tasks share a group only when their cargo commands would differ in nothing but the crates they select. A group has one kind of task, Cargo workspace, feature set, profile, target triple and set of command options, and one environment, as the next paragraph describes. It runs the groups one after another, because each cargo call already uses every core and the groups of one workspace share a build lock.

Nx computes each task's key with that task's environment, which includes the dotenv files it loads for the task: those in the crate's folder and those at the repository root named for the target or a configuration, such as `.env.test`. The batch process gets only the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` ([[EVD-NX-24-INPUT-SEMANTICS]]). The batch implementation therefore rebuilds each task's environment from the same files, in the order Nx reads them, splits a group further where those environments differ, and runs each cargo command with the environment of its tasks. No task runs with another environment than the one its key was computed with.

A group runs one cargo command for each step of its target, one after another. Every target has one step, apart from `test` with the nextest runner, which has the steps of [[DES-TEST-RUN]]: the selection in affected mode, the nextest run and the doctests. Every step starts in the workspace root ([[DES-INVOCATION]]) and selects the crates of the group's tasks in the same way, as [[DES-UNIFICATION]] prescribes, so that every step resolves the same features ([[REQ-STABLE-FEATURES]]) and reuses what the steps before it compiled. A step in which no crate of the group takes part, such as the doctests where no crate has a library, is left out. Before the step of a group of cached `build` or `doc` tasks, the plugin asks cargo once for the group's directories ([[DES-OUTPUTS]]).

The plugin maps the output of every step back to one result per task, whose terminal output holds its part of each step's output, in order. A task succeeds only when cargo reported its result. When a step's command succeeds, every task of the step has passed it. When the command fails, a task passes the step only where cargo's output shows that its crate passed, and a task whose result the output does not show fails, with a message that says why. Each step runs even when a step before it failed for some crates. What cargo reports per crate after a failure was established by experiment ([[EVD-CARGO-BATCH-FAILURES]]):

- **Builds, checks and clippy.** `build`, `check` and `lint` pass `--keep-going` and read cargo's JSON messages. With `--keep-going`, cargo still builds every target that does not need a failed one; without it, cargo starts no new job after the first failure and leaves crates unbuilt that do not depend on the failed one. The messages report each target that cargo built as a `compiler-artifact`, also when it was fresh, and each rustc error as a `compiler-message` that names the package and the target. A failing build script appears only in cargo's human-readable error, and a target that cargo did not reach because something it needs failed does not appear at all. A task of a failed command therefore passes only when the messages report an artifact for every target of its crate that the command builds whatever else is selected, and no error for any target of the crate. Those targets are the library and the binaries, tests, examples and benchmarks that the command's flags select and whose required features the task's own selection turns on, named from the `cargo metadata` report as [[DES-BUILD-INPUT-CHECK]] names the targets of `build`. A target that only another selected crate's features turn on can fail the task only through an error message. So a task fails when its own crate fails or when it needs a crate that failed, and its message names the crates that cargo reported as failed. A failure in a crate that the task does not need does not fail it. When that crate is outside the selection, which can happen under `workspace-build`, the failure is reported as a warning and fails no task.
- **Test runs.** `cargo test` and `cargo test --doc` pass `--no-fail-fast`, so a failing test binary or doctest does not stop the ones after it. `cargo test` has no `--keep-going`: a compile error in any crate that the command compiles stops it before any test runs, the tests of the crates that compiled included. nextest builds all test binaries before it runs one, so its run stops in the same way. Every test task of such a step fails, with a message that names the crates that failed to compile and says that the tests of the others were not run. The plugin does not run the step again without the failing crate, because that would be a further command with another selection of crates. This is a cost of batching: a task that runs its own cargo command runs its crate's tests whatever the state of an unrelated crate. How the output of a test run is attributed to tasks is part of [[DES-TEST-RUN]].

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

cargo-hakari unifies neither the features of workspace members nor those of a third-party crate that depends on a member through normal or build dependencies, and a feature that only a platform-specific dependency table asks for it unifies only on the platforms that its configuration lists ([[EVD-HAKARI-UNIFICATION]], [[RISK-HAKARI-GAPS]]).
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
