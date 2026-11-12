# Continuous integration

> **Status:** specified, not implemented yet. The coverage baseline arrives
> with milestone 0.3.

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

Set `NX_RUST_LOCKED=true` in pipelines. Every cargo command then passes
`--locked` and fails if `Cargo.lock` is out of date, instead of updating it as
plain cargo would.

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
a threshold you set.

Optional additions, all off by default:

| Addition                                       | Use                                                           |
| ---------------------------------------------- | ------------------------------------------------------------- |
| A nightly full run                             | Tests that depend on state outside the repository             |
| Scheduled or batched recollection              | After dependency updates                                      |
| `collect` as the full run on main              | Only if benchmarks justify it                                 |
| A separate build directory for coverage builds | Keeps instrumented and normal builds from evicting each other |

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

Collection is a target of the [[TERM-WORKSPACE-PROJECT]]. Restoring and saving the database are steps of the CI system, not of the plugin. Off by default and available as switches: a nightly full run for tests that depend on external state, scheduled or batched recollection after dependency updates, `collect` as the full run on main, and a separate build directory for coverage builds.

The overhead of `collect` and `collect --diff` is not measured yet ([[RISK-COVERAGE-COST]]).
:::
