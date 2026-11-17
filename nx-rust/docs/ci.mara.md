# Continuous integration

> **Status:** the coverage baseline arrives with milestone 0.3.

v1 targets a single machine: all Rust tasks of a pipeline run on one runner.
JS tasks can be distributed as before.

## Cache two things in two places

| What                             | Cached by                             | Key                                            |
| -------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Task results and final artifacts | Nx, locally or through a remote cache | The task's inputs ([Caching](caching.mara.md)) |
| Cargo's build directory          | Your CI system's cache                | Lockfile and toolchain                         |

Nx never stores the build directory. Without a warm build directory every
pipeline compiles all dependencies from scratch, and the `workspace-build`
feature-unification strategy in particular depends on it
([Batching and features](execution.mara.md)).

A pull request pipeline then needs one step:

```sh
nx affected -t lint test build
```

Every job that runs `nx` needs cargo, also a job that only builds JS projects,
because Nx asks Cargo for the crates when it builds the project graph
([Setup](setup.mara.md)).

Set `NX_RUST_LOCKED=true` in pipelines. Every cargo command that a task runs
then passes `--locked` and fails if `Cargo.lock` is out of date, instead of
updating it as plain cargo would. The exceptions are `update`, because changing
the lockfile is its job, and `fmt` and `fmt-check`, because `cargo fmt` rejects
`--locked`.

A task that Nx restores from the cache runs no cargo at all, and locked mode is
not part of its key. The `lockfile` task of each workspace is not cached,
though, and passes `--locked`: every run in which it runs fails on an outdated
`Cargo.lock`, even when every crate task is restored. A job that runs only
`fmt` or `fmt-check`, excludes task dependencies or runs no Rust task does not
check the lockfile. To check it there as well, run a command of its own in
each workspace, outside Nx:

```sh
(cd rust && cargo metadata --format-version 1 --locked > /dev/null)
```

It fails on an outdated `Cargo.lock` without changing it and compiles nothing.
It resolves the workspace's dependencies, so like a build it needs the
registry or a filled Cargo home.

To fail a pipeline on compiler and clippy warnings without changing what
developers get, set `CARGO_BUILD_WARNINGS=deny` in it; Cargo honours it from
1.97 on. The variable is part of the cache key, so a result that passed
elsewhere with warnings allowed is not reused
([Targets](targets.mara.md#warnings)).

## The coverage baseline

This section applies only with `affectedTests` on ([Testing](testing.mara.md)).
Selecting affected tests needs per-test coverage data from a commit of the main
branch. The main pipeline maintains it:

1. Restore the coverage database from the previous main run.
2. Run the full `test`. Nx's cache limits it to the crates that changed.
3. Run `cargo affected collect --diff`, which re-collects only affected and new
   tests.
4. Save the database to the CI cache, keyed by commit.

The main pipeline does not set `NX_RUST_TEST_MODE`, so in CI its tests run in
mode `full`.

A pull request pipeline sets `NX_RUST_TEST_MODE=affected` and restores the
database for its base commit. The database of an earlier main commit also
works; the diff is then wider and more tests are selected. A pipeline that
forgets the variable runs the full suite, which is slower but never wrong.

A full `collect` replaces `--diff` when the report shows no usable data (the
first run, a lost database, or a changed lockfile, manifest, compiler,
`RUSTFLAGS` or build target), or when the baseline is more commits behind than
a threshold you set. A full `collect` starts from an empty database.

Collecting costs time, memory and cache space on every main commit. Measured
with 4 build jobs and 4 test threads:

| Per main commit                        | ripgrep, 1,220 tests | rust-analyzer, 8,314 tests |
| -------------------------------------- | -------------------- | -------------------------- |
| Plain test run of the commit           | 3.2–3.7 s            | 31–44 s                    |
| `collect --diff` after it              | 1.1–2.5 s            | 52–824 s                   |
| Full `collect` into an empty database  | 12.5–13.1 s          | 645–656 s                  |
| Database to save, `zstd -3` compressed | 53 MB, 2.6 MB        | 8.75 GB, 404 MB            |
| Peak memory of collection, cache incl. | 1.8 GiB              | 6.8 GiB                    |

Collection runs every test it re-collects under instrumentation, and its cost
grows with the number of tests and the code they reach. On rust-analyzer, whose
many fast tests run in 21 s, it cost far more on main than any selection could
save on a pull request. Slow tests make a workspace a candidate for
`affectedTests`, not a sure gain: where the slow tests are integration tests
that start a binary or read shared files, the widening of
[Testing](testing.mara.md) can select the whole suite for common changes and
leave only the overhead. Not measured here: what pull requests save after that
widening, the upkeep of the baseline over many commits, and the time to move
the database between CI runs.

Before you switch it on, measure a few representative changes in your own
repository, each committed on top of a collected commit of main:

```sh
cargo affected collect -- --workspace --no-fail-fast         # once, on main
# commit a representative change, then time each of these:
cargo affected collect --diff -- --workspace --no-fail-fast  # cost on main
NX_RUST_TEST_MODE=full nx affected -t test --skip-nx-cache      # without selection
NX_RUST_TEST_MODE=affected nx affected -t test --skip-nx-cache  # with selection
ls -l target/affected/coverage.db                            # what CI saves
```

Add the cargo arguments of your test runs, such as `--all-features`, after
`--workspace`. Collection's memory grows with the
parallelism: on a runner with little memory, set `CARGO_BUILD_JOBS` and
`NEXTEST_TEST_THREADS` for the collection step. cargo-affected builds the
instrumented tests in `target/affected/build`, so a pipeline that caches
`target` caches them as well.

Optional additions, all off by default:

| Addition                                       | Use                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| A nightly full run                             | Tests that depend on state outside the repository                    |
| Scheduled or batched recollection              | After dependency updates                                             |
| `collect` as the full run on main              | Only if benchmarks justify it                                        |
| A separate build directory for coverage builds | Keeps the instrumented build out of a build directory that CI caches |

## Later: distributing Rust tasks

v1 does not spread Rust tasks across Nx agents. The only thing v1 does for it
is keep "build" and "run" apart inside the test executor
([[DES-TEST-PHASES]]). A distributed mode might look like this:

- One workspace-level task builds everything, writes a nextest archive of the
  test binaries and computes the test selection. Both files are Nx outputs, so
  the remote cache delivers them to agents.
- Per-crate test tasks run from the archive with a package filter. They do not
  invoke cargo, so there is no build lock and no need for batching.
- Only the build machine compiles. Its build directory stays warm through the
  CI cache, and `check` and `lint` are pinned to it.
- Only the build machine needs the coverage database; the selection travels as
  a report file.
- Agents need nextest and the same source checkout, pinned by
  `rust-toolchain.toml`.

The costs: the archive can be large and is uploaded again on every change, any
source change rebuilds it, and tests that read files by path may need changes
to run from an archive. This is a sketch, not a specification.

## Requirements

:::mara requirement REQ-BASELINE
:mid: 01M78FHG7FMF300FJ3R9NCWRAZ
:title: Maintain the coverage baseline on the main branch
:status: accepted
:satisfies: NEED-FAST-TESTS

For a workspace with `affectedTests` enabled, a workspace-level task brings the [[TERM-BASELINE]] up to date for the current commit. It re-collects only what changed when usable data from an earlier commit exists, and collects everything when no usable data exists or the earlier data is further behind than a configured threshold.
:::

## Design

:::mara design DES-BASELINE
:mid: 01M78FHG7F1EWYSCPVF4MY7YGF
:title: Baseline on main
:status: accepted
:satisfies: REQ-BASELINE

The main pipeline runs four steps per workspace:

1. Restore the coverage database from the previous main run.
2. Run the full `test`; Nx's cache limits it to crates that changed. The pipeline sets no test mode, so in CI the mode is `full` ([[DES-TEST-MODE]]).
3. Run `cargo affected collect --diff`, which re-collects only affected and new tests.
4. Save the database to the CI cache, keyed by commit.

Pull request pipelines set `NX_RUST_TEST_MODE=affected` and restore the database for their base commit. An earlier main commit's database also works, with a wider diff.

A full `collect` replaces `--diff` when the report shows no usable data (first run, lost database, or a changed lockfile, manifest, compiler, `RUSTFLAGS` or build target), or when the anchors are more commits behind than a set threshold. The threshold is tuned per repository ([[RISK-BASELINE-DRIFT]]).

A full `collect` starts without the previous database: the target removes `target/affected/coverage.db`, its SQLite files `coverage.db-wal` and `coverage.db-shm`, and the context record before it (**Order of writing**, below). Over an existing database cargo-affected first deletes the rows of the current fingerprint and keeps those of up to ten earlier ones, so that on rust-analyzer a full `collect` over the previous database took 957 s against 652 s into an empty one, and the rows of a fingerprint that a changed lockfile left behind would stay in every database saved after it ([[EVD-COVERAGE-COLLECT-COST]]). The removal touches only cargo-affected's own files, never Cargo's directories. The control plane decided this on 16 November 2026 from [[RISK-COVERAGE-COST]]; `cargo affected clean`, the option not taken, deletes the rows by SQL as slowly. To undo it, the target stops removing the files.

A `collect --diff` that re-collected half of rust-analyzer's tests, after a change to a core crate, took longer than a full `collect` into an empty database, 749–824 s against 645–656 s. The target still runs `--diff` there: telling beforehand would need `cargo affected status`, which reads the database for about as long as `--diff` does before it runs a test, so that the gain would be small.

Collection is a target of the [[TERM-WORKSPACE-PROJECT]]. Restoring and saving the database are steps of the CI system, not of the plugin. Off by default and available as switches: a nightly full run for tests that depend on external state, scheduled or batched recollection after dependency updates, `collect` as the full run on main, and a separate build directory for coverage builds.

**Directories of coverage builds.** By default collection sets no Cargo directory of its own ([[DES-BUILD-DIRS]]), as plain `cargo affected collect` sets none. cargo-affected builds into the artifact directory `target/affected/build` and points the profiles of build scripts there, so that without `build.build-dir` its instrumented build has a build directory of its own. With a `build.build-dir` that both share, the two builds kept their files side by side, and building normally, collecting, and building normally again compiled nothing the second time, on ripgrep and rust-analyzer with Cargo 1.100.0 ([[EVD-COVERAGE-COLLECT-COST]]). The separate build directory is therefore not needed to keep the builds from evicting each other; the switch keeps the instrumented build, about as large as the normal one, out of a build directory that CI caches. The control plane decided on 16 November 2026, from [[REQ-CARGO-UNCHANGED]] and these measurements, against a separate build directory by default; to undo it, the switch becomes the default. Cargo 1.91, the oldest supported version, was not measured: ripgrep at the measured commit needs rustc 1.96. Should an older Cargo make the two builds evict each other in one build directory, the cost is rebuilding, never a wrong result, since Cargo rebuilds what its fingerprints no longer match, and the switch for a separate build directory is the remedy.

Collection runs `cargo affected collect -- --workspace --no-fail-fast` with the cargo arguments of the test runs, such as `--all-features`, which cargo-affected's fingerprint does not hold; without `--no-fail-fast` it stopped at the first failing test and stored part of the suite. It gets git's `diff.relative` as step 1 of [[DES-TEST-RUN]] does. The database the pipeline restores and saves is `target/affected/coverage.db` in the workspace root, whatever `CARGO_TARGET_DIR` or `build.target-dir` say ([[EVD-CARGO-AFFECTED-REPORT]]).

Beside the database, the collection target writes `target/affected/nx-rust-context.json` in the workspace root, the record of the context it collected in ([[ADR-AFFECTED-BASELINE-CONTEXT]]): the cargo options of the collection that change what is compiled or run, namely `--features`, `--all-features`, `--no-default-features`, the profile and `--target`; the target triple that cargo built for; and for every environment input of the workspace's `test` tasks ([[DES-INPUTS]]), those the plugin infers, every variable of the prefixes its list names and those that `envInputs` declares, the SHA-256 of the value or a mark that it was unset, so that no value is written. The pipeline saves and restores the file with the database, and a baseline without it runs the full suite (step 1 of [[DES-TEST-RUN]]). The record is a JSON object of version 2 with the fields `cargo`, `triple`, `env` and `runtime`, which the plugin writes and reads with the same functions (`baseline-context.ts`); the triple is named as step 1 names the group's, the variables are the environment inputs of the `test` tasks as Nx expands them, the prefixed ones included, without `NX_CLOUD_ENCRYPTION_KEY` and `NX_RUST_RUN_ID`, which change nothing that is compiled or run, and `runtime` holds, for every runtime input of the `test` tasks but the test mode command, by its command, the SHA-256 of what it prints when it runs through `sh -c` in the repository root with the collection's environment, as Nx runs a runtime input ([[EVD-NX-24-INPUT-SEMANTICS]]). A record of version 1, without runtime inputs, counts as missing. The control plane decided this form on 16 November 2026 in nxr-tabkjx, which reads the record first; the maintainer added the runtime inputs on 17 November 2026 ([[ADR-AFFECTED-BASELINE-CONTEXT]]).

**Order of writing.** Every collection, full or `--diff`, first removes the context record, and a full one removes the database files with it; the target writes the new record only after cargo-affected has ended successfully. cargo-affected 0.4.1 writes the coverage it collected and only afterwards returns a failure status, and a `--diff` that fails halfway has changed the database as well, so that a record left in place could vouch for coverage from another context: a checkout that holds baseline and record A, then collects with other features or another value of an environment input, would keep A's record beside B's coverage, and a later affected run in context A could leave out a test of a branch that only A takes. A collection that fails or is interrupted therefore leaves no record, and the next affected run takes the full suite, as [[ADR-AFFECTED-BASELINE-CONTEXT]] says for a missing record. The control plane decided this on 16 November 2026 from [[GOAL-TRUSTED-CACHE]] and [[REQ-SELECTION-SAFETY]]; to undo it, the target writes the record before collecting, which the case above shows to be unsafe.

A full `collect` from scratch took 15.7 s on ripgrep and 80 s on tokio at `-j 4` with 4 test threads, and peaked at 1.5 and 4.75 GiB ([[EVD-CARGO-AFFECTED-COST]]). On rust-analyzer it took 645–656 s and peaked at 6.8 GiB, page cache included, and `collect --diff` took 1.1–2.5 s on ripgrep and 52–824 s on rust-analyzer, against a plain test run of 3.2–3.7 s and 31–44 s for the same commits ([[EVD-COVERAGE-COLLECT-COST]], [[RISK-COVERAGE-COST]]).
:::
