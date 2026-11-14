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

Some tasks run one crate per group instead, each with its own cargo command,
as every task did in milestone 0.1: where cargo would give a crate other
features depending on which other crates the same command selects. That is
the case under `hakari` for a feature set given by flags, such as the
all-features configuration, and for a triple that `.config/hakari.toml` does
not list, and under `workspace-build` for a non-host triple. Those runs do not
batch, so they are slower, and a dependency that two such tasks need with
different features is compiled once for each, as in milestone 0.1. A crate's
result never depends on what else runs.

Known limit: while a batch runs, Nx starts no other task. In a mixed repository
JS tasks wait for the Rust batch ([[RISK-BATCH-BEHAVIOUR]]).

## Two batches

`build` and `doc`, whose files Nx stores, run through an executor of their own,
`@convesoft/nx-rust:cargo-outputs`; the other batched targets run
`@convesoft/nx-rust:cargo`. Nx batches each executor's tasks apart and stores a
batch only when it ends, so the `build` batch is stored before a `test` batch
that waits for it starts, and no `cargo test` can change what Nx stores for a
`build` ([Targets](targets.mara.md#tests-that-build-a-crates-binaries)). A
command that runs both kinds shows a batch for each. Each batch forms its own
groups: a `build` that runs one crate per group still runs in the `build` batch.

- A `targetDefaults` entry keyed by `@convesoft/nx-rust:cargo` does not reach
  `build` and `doc`. Key it by `@convesoft/nx-rust:cargo-outputs` as well.
- `nx add` adds an empty entry for each executor of the plugin's targets,
  this one included, where `targetDefaults` has none
  ([Setup](setup.mara.md#adding-the-plugin)).

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

The plugin therefore resolves features for the **whole workspace** wherever
tasks share a cargo command, with one of three strategies, and runs a crate on
its own where they cannot:

| Strategy          | Used when                                                                  | How                                                                               | Cost                                                                                         |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `hakari`          | The workspace has a cargo-hakari configuration and passes the checks below | Build only the selected crates; the hack crate keeps third-party features unified | The hack crate must be kept current, and a check of it runs in every run                     |
| `cargo`           | You opt in; experimental                                                   | Cargo's `resolver.feature-unification = "workspace"`                              | Needs a nightly flag until Cargo stabilises it; a lockfile change runs every crate again     |
| `workspace-build` | Fallback                                                                   | Build the whole workspace, then filter which tests run                            | Compiles unaffected crates; needs a warm build directory; a lockfile change runs every crate |

To choose a strategy yourself, set `featureUnification` in
`[workspace.metadata.nx]` of one workspace, or in the plugin options for all of
them ([Configuration](configuration.mara.md#all-settings)).

### When the hack crate is enough

cargo-hakari unifies the features of third-party crates only. The plugin
therefore uses `hakari` only where it can show that this is enough, whether
`hakari` is the default or you set it. When Nx creates the graph, it checks
each workspace with a cargo-hakari configuration, `.config/hakari.toml`:

| Check                        | Fails when                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Members                      | A member asks another member for a feature, in any form: a `features` list, `default-features = false` on a member that declares a `default` feature, even `default = []`, or `other/feature` and `other?/feature` in its `[features]`; or a member's dev-dependency on itself asks for features |
| Platforms                    | `platforms` in `.config/hakari.toml` does not list your host's triple. `cargo hakari init` leaves the list empty                                                                                                                                                                                 |
| Crates outside the workspace | A crate outside the workspace depends on a member through normal or build dependencies, a `[patch]`, `[replace]` or `paths` entry points at a member, or the plugin cannot see the dependencies of a path crate outside                                                                          |
| Configuration                | `.config/hakari.toml` has a non-empty `traversal-excludes`, `final-excludes` or `registries`, `workspace-hack-line-style = "version-only"`, or another setting that the plugin does not know to leave nothing to the selection                                                                   |

If one fails, the whole workspace uses `workspace-build`, and the plugin says
why: a warning that names the check and the first crate or setting that
failed it, printed when the graph is created and at the start of every task of
the workspace. If that is how your workspace is meant to build, set
`featureUnification = "workspace-build"` in its `[workspace.metadata.nx]`: the
plugin then checks nothing and the warning goes away.

With `hakari`, the plugin also covers what the checks cannot see in advance:

- **A stale hack crate.** Every run that includes a cached task of the
  workspace's crates first runs the workspace's `hakari-check` task, which runs
  `cargo hakari generate --diff` and `cargo hakari manage-deps --dry-run`. If
  the hack crate is stale, it fails with cargo-hakari's output and no task of
  the workspace's crates runs. Run `cargo hakari generate` and
  `cargo hakari manage-deps`, and commit the result. The check is not cached.
  It reads the whole package graph, so on a machine whose Cargo home is empty
  it downloads every package of the lockfile, also those for other platforms,
  and offline it needs them there already, as `cargo fetch` leaves them.
- **Another triple.** Tasks that build for a triple that `platforms` does not
  list run one crate per cargo command. Where the triple is set in the
  repository, such as by `build.target` or a `targetTriple` in a crate's
  table, the plugin also warns and names it; one you pass with
  `--targetTriple` gets no warning.
- **Feature flags.** The all-features configuration, `noDefaultFeatures` and
  `features` run one crate per cargo command, because cargo applies them to
  the crates that a command selects. Only the default features batch.
- **Masked missing features.** A crate can stop declaring a feature it needs
  because the hack crate enables it. An optional strict per-crate build check
  catches this.

The hack crate is never published, and publishing a crate that depends on an
unpublished hack crate stops early with guidance
([Releasing](release.mara.md#dependencies-that-are-not-published)).

Under `hakari` a crate's key holds the hack crate's manifest and
`.config/hakari.toml` in place of the other members' manifests. Under
`workspace-build` and `cargo`, which build with the features of the whole
workspace, it holds what any member can change: every member's manifest, the
locked packages of every member, and the path crates outside the workspace
that any member uses. A change to `Cargo.lock` then runs every crate of the
workspace again ([Caching](caching.mara.md#lockfile-changes)).

## Feature sets and target triples

- Feature sets are Nx configurations at workspace level: the default features
  and all features.

  ```sh
  nx run-many -t test                     # default features
  nx run-many -t test -c all-features
  ```

- A crate that needs something else names it as `crate/feature`, or forms its
  own group.
- Under `hakari`, every feature set but the default features runs one crate
  per cargo command: these configurations do not batch. Under
  `workspace-build`, the whole workspace builds with the flags, which then act
  on every member, so they batch on the host.
- A platform triple for the same kind of artifact is a flag. A different kind
  of artifact, such as wasm or a Node addon, gets its own target
  ([napi and wasm artifacts](artifacts.mara.md)). Under `workspace-build`, a
  non-host triple runs one crate per cargo command, because the whole
  workspace may not build for it.
- v1 runs tests on the host triple only.

## Requirements

:::mara requirement REQ-BATCHING
:mid: 01M78FHG7FRS15ZD38BR42JSK7
:title: Run a group of tasks with one cargo command per step
:status: accepted
:satisfies: NEED-EFFICIENT-BUILDS

Tasks of one [[TERM-GROUP]] that Nx runs in the same command are served together, without the user passing a flag: with one cargo command for each step of their target, so that the number of cargo commands depends on the target and not on how many tasks the group has. Each task still has its own result, its own terminal output and its own cache entry, and a task restored from the cache takes no part in the commands. A task fails only when its own crate fails in any step, or a crate it depends on fails; a failure elsewhere in the group does not fail it. Tasks whose commands would differ in more than the crates they select are never served together. Serving tasks together never lets Nx store, under one task's key, files that another task's cargo command wrote.
:::

:::mara requirement REQ-STABLE-FEATURES
:mid: 01M78FHG7FNYQZJD8HRKA23YRY
:title: Make a crate's result independent of its batch
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-EFFICIENT-BUILDS

A crate's result does not depend on which other crates run in the same Nx command, so a cached result is valid whatever ran beside it. For tasks that share a cargo command, the features with which a crate and its dependencies are compiled are the same whatever the command selects: two runs that select different sets of crates from one workspace compile shared dependencies with the same features, so neither rebuilds what the other built. A task whose crate runs alone in its command, because a shared command would make its features follow the selection ([[DES-BATCH]], "Groups of one crate"), is compiled with what its crate and its dependencies ask for, the same in every run, so its result depends only on what its own key holds. Between such tasks, a shared dependency can be compiled in more than one variant, which cargo keeps side by side, so that running them in another order compiles nothing that commands for one crate each would not.
:::

## Design

:::mara design DES-BATCH
:mid: 01M78FHG7FY1VKFFHZ8G4WFDBJ
:title: Batch executor
:status: accepted
:satisfies: REQ-BATCHING
:mitigates: RISK-NX-INPUT-SEMANTICS

The plugin's cargo executor declares a `batchImplementation` and `preferBatch: true` in `executors.json`. Nx then hands the executor all runnable tasks of that executor at once, without `--batch`, and still hashes, restores and caches each task individually ([[ADR-BATCH-EXECUTOR]]).

**Two batch executors.** `build` and `doc`, the targets whose files Nx stores ([[DES-OUTPUTS]]), run `@convesoft/nx-rust:cargo-outputs`, a second entry of `executors.json` with the same implementation and schema; the other batched targets run `@convesoft/nx-rust:cargo` ([[DES-TARGETS]]). Nx forms a batch from the runnable tasks of one executor and adds to it the tasks of the same executor that depend on them, stores the results and outputs of a batch only when the whole batch has ended, and awaits a batch, storing included, before it starts anything else ([[EVD-NX-24-BATCHES]]). With one executor, a crate's `build` and the `test` that waits for it ([[DES-TARGETS]]) would form one batch, the `test` group would run after the `build` group, and Nx would store the executable of `cargo test` under the key of `build`, as it did for 12 of 12 entries in [[EVD-CARGO-ARTIFACT-WRITERS]]. With two, such a `test` becomes runnable only once the batch of its `build` has run and been stored, and none of 12 entries was wrong. The batch implementation forms its groups inside each batch, below: the `cargo-outputs` batch holds the groups of `build` and `doc`, groups of one crate among them (**Groups of one crate**), and the other batch the groups of every other kind. Inside each batch the groups run one after another, in an order that the dependencies between their tasks allow, and Nx stores the batch only when all its groups have run, so splitting a group into groups of one crate changes how many cargo commands run, not when Nx stores, and no group of a `test`, of one crate or of several, runs inside the batch of the `build` it waits for. The groups of `build` and `doc` write different files, since `cargo doc` leaves the executables alone and only `doc` writes the `doc` folder. A `build` that Nx restores from the cache before a `test` batch runs is replaced on disk by the `cargo test` of that batch, while its entry stays right, as after any command that runs both ([[RISK-ARTIFACT-DIR-WRITERS]]). The guard of [[DES-TARGETS]] reads the task graph of the command, which every batch receives whole. For users, the executor of `build` and `doc` is `@convesoft/nx-rust:cargo-outputs`: a `targetDefaults` entry keyed by `@convesoft/nx-rust:cargo` no longer reaches them, [[DES-TARGET-DEFAULT-GUARD]] judges each executor's entries for its own targets, and `init` adds an empty entry for each executor of the plugin's targets, this one included, where `targetDefaults` lacks one ([[DES-GENERATORS]]).

The batch implementation splits its tasks into groups ([[TERM-GROUP]]): tasks share a group only when their cargo commands would differ in nothing but the crates they select. A group has one kind of task, Cargo workspace, feature set, profile, target triple and set of command options, and one environment, as the next paragraph describes. It runs the groups one after another, because each cargo call already uses every core and the groups of one workspace share a build lock.

**Groups of one crate.** A group never passes a flag whose effect on a crate depends on which other crates the same cargo command selects, and never selects crates whose features cargo would then resolve for that selection alone. Where its command would do either, each of its tasks forms a group of its own, which selects that crate alone, by its package ID specification as every command selects its crates ([[DES-INVOCATION]], "Selecting a crate"), as milestone 0.1 does for every task and as a plain `cargo test` of that one crate with `--all-features` does; "one cargo command per step" holds for each such group. The control plane decided this on 14 November 2026 under [[GOAL-TRUSTED-CACHE]] and [[REQ-STABLE-FEATURES]], of which the maintainer is told, because it costs speed and never a result. It applies:

- Under `hakari`, to a feature set given by flags: `--all-features`, `--no-default-features` and every `--features`. Cargo 1.91.0 and 1.100.0 apply `--all-features` and `--no-default-features` to the selected crates only, give an unqualified name in `--features` to each selected crate that has it, and accept `crate/feature` only where a selected crate is that crate or depends on it directly, so that a crate that another selected crate depends on is compiled with other features, or the command fails, depending on what else it selects ([[EVD-HAKARI-UNIFICATION]]). Only the default features share a command.
- Under `cargo`, to every `--features`, which cargo still checks against the selected crates; under workspace unification, `--all-features` and `--no-default-features` act on every member whatever the selection, and share a command ([[EVD-HAKARI-UNIFICATION]]).
- To a triple for which features are not resolved for the whole workspace: a non-host triple under `workspace-build`, whose groups cannot build the whole workspace ([[DES-FEATURE-SETS]]), and under `hakari` a triple, or a host, that `platforms` does not list ([[DES-UNIFICATION]]).

Under `workspace-build` on the host, a group builds the whole workspace, so its flags act on every member, and it shares one command whatever its feature set. A command that selects one crate resolves features for that crate and what it depends on, so its result depends only on the crate's own dependencies, which every key of [[DES-INPUTS]] covers: the keys of the whole-workspace strategies are a superset of them, and under `hakari` a crate's key holds them with the hack crate's manifest. A crate that another task's crate depends on can then be compiled twice, once with its own task's flags and once as the dependency, and cargo keeps both builds side by side, so running the tasks in another order compiles nothing that per-crate commands would not ([[EVD-HAKARI-UNIFICATION]]). Such groups do not batch: they cost a cargo command, and its wait for the build lock, per crate and step.

Nx computes each task's key with that task's environment, which includes the dotenv files it loads for the task: those in the crate's folder and those at the repository root named for the target or a configuration, such as `.env.test`. The batch process gets only the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` ([[EVD-NX-24-INPUT-SEMANTICS]]). The batch implementation therefore rebuilds each task's environment from the same files, in the order Nx reads them, splits a group further where those environments differ, and runs each cargo command with the environment of its tasks. No task runs with another environment than the one its key was computed with.

A group runs one cargo command for each step of its target, one after another. Every target has one step, apart from `test` with the nextest runner, which has the steps of [[DES-TEST-RUN]]: the selection in affected mode, the nextest run and the doctests. Every step starts in the workspace root ([[DES-INVOCATION]]) and selects the crates of the group's tasks in the same way, as [[DES-UNIFICATION]] prescribes, so that every step resolves the same features ([[REQ-STABLE-FEATURES]]) and reuses what the steps before it compiled. A step in which no crate of the group takes part, such as the doctests where no crate has a library, is left out. Before the step of a group of cached `build` or `doc` tasks, the plugin asks cargo once for the group's directories ([[DES-OUTPUTS]]).

The plugin maps the output of every step back to one result per task, whose terminal output holds its part of each step's output, in order. The checks that follow cargo run for each task after the last step of its group, a group of one crate included: the lockfile post-check, on the digests that [[DES-LOCKFILE-HASHING]] names, and for `build` the check of [[DES-BUILD-INPUT-CHECK]]. A task succeeds only when cargo reported its result. When a step's command succeeds, every task of the step has passed it. When the command fails, a task passes the step only where cargo's output shows that its crate passed, and a task whose result the output does not show fails, with a message that says why. Each step runs even when a step before it failed for some crates. What cargo reports per crate after a failure was established by experiment ([[EVD-CARGO-BATCH-FAILURES]]):

- **Builds, checks and clippy.** `build`, `check` and `lint` pass `--keep-going` and read cargo's JSON messages. With `--keep-going`, cargo still builds every target that does not need a failed one; without it, cargo starts no new job after the first failure and leaves crates unbuilt that do not depend on the failed one. The messages report each target that cargo built as a `compiler-artifact`, also when it was fresh, and each rustc error as a `compiler-message` that names the package and the target. A failing build script appears only in cargo's human-readable error, and a target that cargo did not reach because something it needs failed does not appear at all. A task of a failed command therefore passes only when the messages report an artifact for every target of its crate that the command builds whatever else is selected, and no error for any target of the crate. Those targets are the library and the binaries, tests, examples and benchmarks that the command's flags select and whose required features the task's own selection turns on, named from the `cargo metadata` report as [[DES-BUILD-INPUT-CHECK]] names the targets of `build`. A target that only another selected crate's features turn on can fail the task only through an error message. So a task fails when its own crate fails or when it needs a crate that failed, and its message names the crates that cargo reported as failed. A failure in a crate that the task does not need does not fail it. When that crate is outside the selection, which can happen under `workspace-build`, the failure is reported as a warning and fails no task.
- **Test runs.** `cargo test` and `cargo test --doc` pass `--no-fail-fast`, so a failing test binary or doctest does not stop the ones after it. `cargo test` has no `--keep-going`: a compile error in any crate that the command compiles stops it before any test runs, the tests of the crates that compiled included. nextest builds all test binaries before it runs one, so its run stops in the same way. Every test task of such a step fails, with a message that names the crates that failed to compile and says that the tests of the others were not run. The plugin does not run the step again without the failing crate, because that would be a further command with another selection of crates. This is a cost of batching: a task that runs its own cargo command runs its crate's tests whatever the state of an unrelated crate. How the output of a test run is attributed to tasks is part of [[DES-TEST-RUN]].

Known issue: since Nx 22.7, no other task starts while a batch runs, so JS tasks wait for a Rust batch ([[RISK-BATCH-BEHAVIOUR]]).
:::

:::mara design DES-UNIFICATION
:mid: 01M78FHG7F43VP2172VYY8A41Q
:title: Feature unification strategies
:status: accepted
:satisfies: REQ-STABLE-FEATURES
:mitigates: RISK-HAKARI-GAPS

Features are never resolved for the set of crates that happens to be selected ([[ADR-WORKSPACE-FEATURES]]): a group that shares a cargo command resolves them for the whole workspace, and a task whose group cannot runs its crate alone ([[DES-BATCH]], "Groups of one crate"). One option chooses how the whole workspace is resolved:

| Strategy          | Used when                                                                  | How                                                                                        | Cost                                                                                                       |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `hakari`          | The workspace has a cargo-hakari configuration and passes the checks below | Build only the selected crates; the [[TERM-HACK-CRATE]] keeps third-party features unified | The hack crate must be kept current; an uncached drift check in every run                                  |
| `cargo`           | Opted in; experimental                                                     | `resolver.feature-unification = "workspace"`                                               | Needs a nightly flag until Cargo stabilises it; keys follow the whole workspace ([[DES-INPUTS]])           |
| `workspace-build` | Fallback, also for a workspace that fails a check below                    | Build the whole workspace and filter which tests run                                       | Compiles unaffected crates; needs a warm build directory; keys follow the whole workspace ([[DES-INPUTS]]) |

cargo-hakari unifies neither the features of workspace members nor those of a third-party crate that depends on a member through normal or build dependencies, and a feature that only a platform-specific dependency table asks for it unifies only on the platforms that its configuration lists ([[EVD-HAKARI-UNIFICATION]]). The `hakari` strategy therefore adds the following to what hakari does.

**When the hack crate is enough.** The maintainer decided on 14 November 2026 to keep the strategy in milestone 0.2 with full detection: the plugin uses the hack crate only where it can show that doing so is safe, and otherwise falls back to `workspace-build` with a message that says why. Moving the strategy out of milestone 0.2 was the option not taken. A workspace thus uses `hakari`, whether it is the default or `featureUnification` sets it, only when it has a configuration that cargo-hakari reads, `.config/hakari.toml` in the workspace root or else `.guppy/hakari.toml` ([[EVD-HAKARI-UNIFICATION]]), that parses and whose `hakari-package` names a member, and when it passes four checks, which graph creation makes from what it reads anyway; the drift check runs before the tasks (**Drift**, below).

1. **No member asks a feature of another member, in any form.** In the `--no-deps` report ([[DES-METADATA-REPORT]]), take every dependency of a member whose path is the folder of another member, of every kind (normal, build and dev) and under every platform table, renamed, optional and inherited with `workspace = true` ones included, for which the report gives the features of `[workspace.dependencies]` and of the member merged. The check fails where such a dependency has a non-empty `features` list, or turns off default features while the other member's `features` table declares `default`, also as `default = []`, which still gives the member `feature = "default"` when it is selected itself; or where an entry of the member's `features` table names a feature of it as `<name>/<feature>` or `<name>?/<feature>`, by the dependency's name or its rename. It fails as well where a member's dev-dependency on itself, whose path is its own folder, has a non-empty `features` list: when the member is selected for its tests or with `--all-targets`, cargo compiles it with those features for every crate of the command that links it. A plain dependency with default features asks nothing beyond what the member has when it is selected itself, and turning off default features of a member that declares no `default` changes nothing ([[EVD-HAKARI-UNIFICATION]], "Features that no manifest asks for"). A use of a member through a registry or git dependency that a redirection replaces is the third check's.
2. **`platforms` lists the host.** `platforms` in the configuration lists the host's triple, as `rustc -vV` names it in the workspace root, run as graph creation runs cargo ([[DES-METADATA-REPORT]]). The host counts for every task, also one that builds for another triple, because build scripts and proc macros are compiled for it. So a workspace whose `platforms` is empty, as in the configuration that `cargo hakari init` writes ([[EVD-HAKARI-UNIFICATION]]), or lists other triples only, falls back to `workspace-build`: running every task one crate per command would give up batching altogether, while `workspace-build` batches the whole workspace. Machines with different hosts can thereby use different strategies for one workspace; their keys differ anyway, because the toolchain input names the host ([[DES-INPUTS]]). A non-host triple that `platforms` does not list makes nothing fall back. The maintainer chose on 14 November 2026 "Keep `hakari`; that triple runs per crate (Recommended)", which refines his first answer, under which the whole workspace fell back; that falling back was the option not taken. The tasks that build for such a triple run one crate per command (**Triples that `platforms` does not list**), whether graph creation knows the triple, from `build.target` or `CARGO_BUILD_TARGET` ([[DES-OUTPUTS]]) or from a `targetTriple` that the metadata tables give a target of a member or one of its configurations ([[DES-PLUGIN-OPTIONS]]), or only a task names it. A target specification file is never listed.
3. **No crate outside the workspace reaches a member through normal or build dependencies.** cargo-hakari leaves such a crate out of the hack crate, so its features, and those that it asks of the member, follow the selection; a crate that reaches a member only through a dev-dependency goes into the hack crate and passes ([[EVD-HAKARI-UNIFICATION]]). The `--no-deps` report does not show crates outside the workspace, and the full report that does is ruled out at graph creation ([[ADR-METADATA-NO-DEPS]]), so the check uses the crates outside the workspace whose dependencies the plugin knows from the reports it requests anyway ([[DES-METADATA-REPORT]]): the path crates that the members reach by path, through their dependencies of every kind and behind those through normal and build dependencies, through any number of such crates with a project or without; and the crates that the workspace's `[patch]`, `[replace]` and `paths` entries name, with the crates behind them by path ([[DES-PROJECT-GRAPH]]). The check fails where one of them reaches a member, matched by real folder, through normal or build dependencies, directly or through other such crates. Where the plugin cannot tell without the full report, it does not assume safety, and the check fails in exactly these shapes:
   - a redirection of the workspace whose crate is a member: a `[patch]` or `[replace]` entry whose path is a member's folder, or a `paths` entry below whose folder discovery finds a member. Any registry or git crate that depends on that name then depends on the member, and only `Cargo.lock` or the full report shows whether one does; graph creation reads neither ([[DES-METADATA-REPORT]]);
   - a crate among those above without a report, whose dependencies are unknown: one whose folder holds `.cargo-checksum.json` ([[ADR-SKIP-VENDORED-CRATES]]), and one whose report cargo refused with a warning ([[DES-METADATA-REPORT]]).

   No other crate can reach a member: a registry crate names no path, and what a git crate names by path lies in its own repository, so either reaches a member only through such a redirection.

4. **The configuration leaves nothing to the selection.** Some settings of cargo-hakari's configuration leave packages out of unification, and `generate --diff` and `verify` still pass ([[EVD-HAKARI-UNIFICATION]]). The control plane decided on 14 November 2026, under [[GOAL-TRUSTED-CACHE]] and with the maintainer told, that what is not shown to be safe counts as unsafe. The check therefore passes only where every key of the configuration is one of these, with a value for which experiments with cargo-hakari 0.9.39 found the features of every third-party crate the same in every selection ([[EVD-HAKARI-UNIFICATION]]):
   - `hakari-package`, which names a member, and `platforms` (the second check);
   - `resolver`: `"1"`, `"2"` or `"3"`, whatever the workspace's resolver;
   - `unify-target-host`: `"auto"`, `"none"`, `"unify-if-both"` or `"replicate-target-on-host"`;
   - `dep-format-version`: `"1"` to `"4"`; `exact-versions` and `output-single-feature`: `true` or `false`;
   - `workspace-hack-line-style`: `"full"` or `"workspace-dotted"`;
   - `traversal-excludes`, `final-excludes` and `registries`, only where they are empty.

   It fails for a non-empty `traversal-excludes` or `final-excludes`, which leave members or third-party crates out of unification; for `workspace-hack-line-style = "version-only"`, with which the members' dependency on the hack crate names no path and features followed the selection; for a non-empty `registries`, which was not tried; and for any other key or value. The configuration that `cargo hakari init` writes passes once `platforms` is filled in.

**Fallback.** When a check fails, the whole workspace uses `workspace-build`: its crates' targets get that strategy's inputs ([[DES-INPUTS]]), it has no `hakari-check` target, and its groups build the whole workspace ([[DES-BATCH]]). Graph creation warns, and the warning names the workspace, the check, and the first member, crate, entry or setting that fails it, in a fixed order: the checks as numbered above, and members and crates by the path of their manifests. It says what would change the outcome: for the platforms, to add the host's triple to `platforms` and run `cargo hakari generate`; for the configuration, what is missing in which file, or the key and value of the setting that the plugin does not accept; and in every case that `featureUnification = "workspace-build"` in the workspace table makes the choice explicit, which ends the warning. The warning concerns every project of the workspace, crates and workspace project, and goes the way of the other warnings found when the graph is created: printed then, by `init`, and at the start of every task of those projects, with its digest in their named input `nx-rust-warnings`, so that the keys of their tasks change when it appears or goes away ([[DES-DIAGNOSTICS]], "Warnings where they are seen"). A workspace whose strategy is `cargo` or `workspace-build`, by default or by setting, is not checked and draws no warning.

**What the choice depends on.** The checks read the members' manifests and the root manifest, through the report; the configuration file of cargo-hakari; the manifests of the crates outside the workspace and the redirection tables of the root manifest and of Cargo's configuration files, with the folders below a `paths` entry, as for the graph's edges ([[DES-METADATA-REPORT]]); and, for the host, the toolchain in the workspace root. The other triples that graph creation knows, from Cargo's configuration files, `CARGO_BUILD_TARGET` and the members' metadata tables, decide only the warning about a triple that `platforms` does not list. Graph creation reads all of them afresh in every computation ([[ADR-NO-METADATA-CACHE]]). Without the Nx daemon, every command creates the graph. With the daemon, a change to a file inside the repository that Nx sees, such as a member's manifest or `.config/hakari.toml`, makes it run every plugin's `createNodes` again, as does a command that brings another environment ([[EVD-CARGO-REDIRECTIONS]], [[EVD-NX-24-WARNING-CHANNELS]]). The new graph gives the workspace's targets the inputs of the strategy that now applies, which are part of the project configuration that Nx hashes into every key, and adds or removes the warning, whose digest is in the keys as well ([[DES-INPUTS]], "Beyond the declared inputs"). A change that flips the answer therefore changes the key of every task of the workspace's crates. A file outside the repository or one that Nx ignores, such as a `[patch]` in the Cargo home's configuration, and a toolchain switched outside the repository reach the choice only when Nx creates the graph again, as they reach the edges ([[ADR-REDIRECTION-EDGES]]); the warning about such a configuration file says so ([[DES-DIAGNOSTICS]]), and a host that changed is handled as below.

**Triples that `platforms` does not list.** When the batch implementation forms the groups of a workspace that uses `hakari`, it reads the triples that each task's cargo commands build for, as it reads them for the outputs ([[DES-OUTPUTS]]), and the host's triple with `rustc -vV` in the workspace root and the task's environment. Where one of them is not among the `platforms` that graph creation recorded in the project's metadata, the hack crate does not unify the dependencies under that platform's tables, and the task forms a group of one crate ([[DES-BATCH]], "Groups of one crate"): its command resolves features for its crate alone, which its key under `hakari` covers. That holds for a non-host triple that graph creation knows, for which it also warns, naming the triple and `platforms`, saying that the tasks for it run one crate per command and that adding it to `platforms` and running `cargo hakari generate` lets them share commands. The warning concerns every project of the workspace and is printed and keyed like the fallback warning ([[DES-DIAGNOSTICS]]). It holds as well, without a warning, for a triple that graph creation does not see: one that the command line, a `project.json`, `targetDefaults` or a dotenv file of the task gives, or one that a configuration file outside the repository picks after the daemon created the graph, and for a host whose toolchain changed since. A triple that `platforms` lists shares a command as designed: the hack crate unifies third-party features on that platform, the first check fixes the features of members, and a feature set given by flags runs one crate per command (**Feature flags**).

**Feature flags.** Cargo applies `--all-features`, `--no-default-features` and `--features` to the crates that a command selects, so under `hakari` a group with a feature set given by flags runs one crate per command ([[DES-BATCH]], "Groups of one crate"). A member that is only a dependency in such a command is then built with what its dependents ask, which the first check fixes to its default features, whatever else the Nx command runs; and the hack crate carries the third-party features that every member asks for with all its features, which `generate` takes into account ([[EVD-HAKARI-UNIFICATION]]). Under `cargo`, `--features` runs one crate per command, while `--all-features` and `--no-default-features` act on every member and share one.

**Drift.** A workspace that uses `hakari` has the target `hakari-check` on its workspace project ([[DES-WORKSPACE-TARGETS]]). It runs `cargo hakari generate --diff` and then `cargo hakari manage-deps --dry-run` in the workspace root, and fails when either fails, with cargo-hakari's output and a message that says to run `cargo hakari generate` and `cargo hakari manage-deps` and commit the result. `cargo hakari verify` is not used: it passes for a member without the dependency on the hack crate, while these two commands caught every stale case tried, a missing feature, a new member without the dependency and a hack crate that gives more than the members ask for ([[EVD-HAKARI-UNIFICATION]]). Neither command writes a file. Following the pattern of the lockfile task ([[DES-LOCKFILE-HASHING]]):

- The target is not cached and runs whenever a task that depends on it runs. Every cached target of the workspace's crates that depends on the lockfile task, and the workspace's `doc`, depends on it, and it depends on the lockfile task, so that cargo-hakari reads the lockfile that the crates' keys hold. When it fails, Nx skips the tasks that depend on it and stores nothing for a skipped task, also with `NX_CACHE_FAILURES=true` ([[EVD-NX-24-BATCHES]], "Dependents of a failed task"). It is not cached because its verdict depends on the whole package graph, which also follows files outside the repository, such as a `[patch]` in the Cargo home's configuration, as the lockfile task's verdict does. It uses an executor without a batch implementation, so it never joins a batch.
- It is the second exception that [[REQ-NO-RUST-TASK-DEPS]] makes: a target of the workspace project, not of another crate, that depends on nothing but the lockfile task, so it adds no task cycle ([[DES-PROJECT-GRAPH]]). A cached crate task whose task graph holds no dependency on it, in a run that does not exclude task dependencies, as where a `project.json` replaces the target's `dependsOn`, fails before cargo runs, as one without the lockfile task does. A run with `--exclude-task-dependencies` runs neither, and `NX_RUST_RUN_ID` keeps whatever the crate tasks store from being restored ([[DES-LOCKFILE-HASHING]], "Excluded dependencies").
- cargo-hakari is the user's to install ([[ADR-V1-SCOPE]]). Where it is missing, the task fails with the message for a missing tool ([[DES-DIAGNOSTICS]]).
- Both commands read the whole package graph through `cargo metadata`, which needs the manifest of every package in the lockfile, for every platform ([[EVD-HAKARI-UNIFICATION]], [[ADR-METADATA-NO-DEPS]]). On a machine whose Cargo home lacks them, the check downloads them, also those that the build itself does not need. Offline, through `CARGO_NET_OFFLINE` or `net.offline`, it fails until they are there, as `cargo fetch` without `--target` leaves them.
- cargo-hakari passes cargo no `--locked` and takes no such flag ([[EVD-HAKARI-UNIFICATION]]). It needs none: in locked mode the lockfile task before it fails on a stale or missing `Cargo.lock`, and cargo leaves a current one alone ([[DES-INVOCATION]]). A lockfile that changes while the run goes on fails the crate tasks through the lockfile task's post-check ([[DES-LOCKFILE-HASHING]], "Post-check").

**What the keys hold.** Under `hakari`, a crate's key leaves out the other members' manifests and holds only its own digest. In their place it holds the hack crate's manifest and the configuration file of cargo-hakari ([[DES-INPUTS]], "Hack crate"). The drift check passes only where the hack crate is what cargo-hakari generates from the members' manifests, the lockfile and its configuration, so that the hack crate's manifest then stands for what the other members ask of third-party crates, and the four graph-time checks establish that this is all that the other members can change. With a stale hack crate, a crate's result would depend on its batch under a key that does not change; but then the drift check fails and no task of the workspace's crates runs, so nothing is stored. Generating the hack crate again changes its manifest and with it every key, and undoing the change that made it stale brings back the state for which the stored results hold.

**Masked missing features.** A crate can stop declaring a feature it needs because the hack crate enables it. An optional strict per-crate build target catches this.

**Publishing.** The plugin never publishes the hack crate. Publishing a crate that depends on a hack crate with `publish = false` fails before cargo runs and points to cargo-hakari's ways of publishing such a crate ([[DES-RELEASE]]).

[[RISK-HAKARI-GAPS]] records what remains that no check sees.
:::

:::mara design DES-FEATURE-SETS
:mid: 01M78FHG7FBXD8XDCTFPZQD2QA
:title: Feature sets and target triples
:status: accepted
:satisfies: REQ-BATCHING
:satisfies: REQ-STABLE-FEATURES

Feature sets are Nx configurations at workspace level: the default features and all features. A crate that needs another set either names single features as `crate/feature` or forms its own group. Because features are target options, Nx hashes them ([[DES-INPUTS]]). A feature set given by flags shares a cargo command only where the flags act on every member whatever the command selects: under `workspace-build` on the host, which builds the whole workspace, and for `--all-features` and `--no-default-features` under `cargo`. Elsewhere, and so under `hakari` for every feature set but the default features, each crate gets a command of its own ([[DES-BATCH]], "Groups of one crate").

A platform triple for the same kind of artifact is an option of the target, `targetTriple` ([[DES-PLUGIN-OPTIONS]]). Without it, `build.target` in Cargo's configuration or `CARGO_BUILD_TARGET` can pick triples, and the outputs follow them ([[DES-OUTPUTS]]). A different kind of artifact gets its own named target ([[ADR-ARTIFACT-TARGET-NAMES]]). A non-host triple is a group of its own and builds only the selected crates, because building a whole workspace for such a triple would include crates that cannot target it. Under `workspace-build`, nothing else resolves the features of such a group for the whole workspace, so each of its crates gets a command of its own, which resolves features for that crate and what it depends on ([[DES-BATCH]], "Groups of one crate"). The keys of `workspace-build` hold every member's manifest and digest and the crates outside the workspace that any member reaches ([[DES-INPUTS]]), a superset of what such a command depends on. Under `hakari`, the crates of a group for a triple that `platforms` lists share a command, in a workspace that passes every check: the hack crate unifies the third-party features on that platform, the first check fixes the features of members, and a feature set given by flags runs one crate per command; a triple that `platforms` does not list runs one crate per command ([[DES-UNIFICATION]]). v1 runs tests on the host triple only.
:::
