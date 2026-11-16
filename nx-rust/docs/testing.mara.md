# Testing

> **Status:** `test` runs `cargo test` for its crate. The plugin reads and
> checks `testRunner` and `affectedTests`, hashes nextest's configuration for
> `testRunner = "nextest"`, and fails graph creation for `affectedTests = true`
> among the options of `test` in a workspace without the setting. The rest of
> this page arrives with milestone 0.3: nextest and its doctests, affected
> tests and `NX_RUST_TEST_MODE`, the error for `affectedTests` without
> nextest, and the check of `--affectedTests=true` on the command line.

Every crate has one `test` target. Which runner it uses, and whether it runs
the whole suite or only the tests a change can affect, are settings. You never
deal with extra targets.

```sh
nx test api
nx affected -t test
```

## Options

| Option          | Values             | Default | Meaning                                                                                                                               |
| --------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `testRunner`    | `cargo`, `nextest` | `cargo` | Plain `cargo test`, or [nextest](https://nexte.st)                                                                                    |
| `affectedTests` | `true`, `false`    | `false` | The workspace uses test selection with [cargo-affected](https://github.com/max-sixty/cargo-affected). Needs `testRunner = "nextest"`. |

```toml
# rust/Cargo.toml
[workspace.metadata.nx]
testRunner = "nextest"
affectedTests = true
```

Both go into the plugin options for every workspace, or into
`[workspace.metadata.nx]` for one; a crate cannot change them
([Configuration](configuration.mara.md#all-settings)). Turning on
`affectedTests` without nextest fails when the graph is created, with a message
that says so.

A crate can opt out of selection with the option of its `test` target that
`--affectedTests=false` sets for one run, and then always runs its full suite:

```toml
# rust/crates/legacy/Cargo.toml
[package.metadata.nx.targets.test.options]
affectedTests = false
```

Setting the option to `true` in a workspace without `affectedTests` fails when
the graph is created, and `--affectedTests=true` on the command line fails the
task before cargo runs: the workspace setting turns selection on.

Doctests always run when nextest is the runner: nextest does not run them, so
the plugin runs `cargo test --doc` as a second step. A group of `test` tasks
([Batching and features](execution.mara.md)) therefore takes two cargo calls
with nextest, one for the tests and one for the doctests, and three in affected
mode, where the selection of tests comes first. With `cargo test` it takes one.

Under the `workspace-build` strategy a group runs only its own test binaries,
through a small runner that the plugin passes to cargo, and the doctests of the
whole workspace, of which it keeps its own results; a runner that you
configured for your host makes each crate's tests run on their own instead
([Tests under `workspace-build`](execution.mara.md#tests-under-workspace-build)).

## Affected tests

`affectedTests` says that a workspace is set up for selection. It puts the test
mode into the cache key, adds the baseline target to the workspace project, and
has every machine check for nextest and cargo-affected, so a missing tool shows
on your machine and not first in CI. Whether a run actually selects is a second
question, answered per run.

Each run of `test` in such a workspace is in one of two modes:

- **`affected`** runs the tests that cargo-affected selects against the
  coverage baseline for changed Rust code. Every other change runs all tests of
  the crates whose inputs hold it and of the crates that depend on them:
  `build.rs`, proc-macro source, toolchain files, `.cargo/config.toml`,
  non-Rust files and the files that `fileInputs` declares. A change to a crate
  with a binary also runs all tests of the crates that depend on it, because
  their tests may start the binary. A baseline collected with other features,
  another profile or triple, or other values of the task's environment inputs
  runs the full suite.
- **`full`** runs the whole suite.

The plugin does not guess the mode from branch names. You choose it with the
`NX_RUST_TEST_MODE` environment variable, and without the variable the default
depends on where the run happens:

| Where        | `NX_RUST_TEST_MODE`  | Mode       |
| ------------ | -------------------- | ---------- |
| Your machine | not set              | `affected` |
| CI           | not set              | `full`     |
| Anywhere     | `affected` or `full` | As set     |

CI is whatever Nx itself treats as CI: the `CI` variable, or the variables the
common CI systems set. So local work gets selection without any setup, and a
pipeline that sets nothing runs everything. The usual arrangement:

- The pull request pipeline sets `NX_RUST_TEST_MODE=affected`.
- The main pipeline sets nothing and runs the full suite. Nx's cache limits
  that to the crates that changed, so main gets a full run once per code state.

When selection is not possible, for example because there is no baseline, the
full suite runs, and the task output says so and gives the reason.

An affected run never stands in for the full run. One kind of change can pass
in affected mode and fail in full: code that another crate evaluates while it
compiles, such as a `const fn` used in a `const` or a `macro_rules!` macro,
leaves no coverage for that crate's tests, so a change to it selects only the
tests that run it. A build script that reads a Rust file of its own crate
needs that file in `fileInputs` for a change to it to run all of the crate's
tests.

For a one-off full run:

```sh
NX_RUST_TEST_MODE=full nx test api
nx test api --affectedTests=false   # the same suite, under a cache key of its own
```

Setting up the baseline in CI is described under
[Continuous integration](ci.mara.md).

## Why the cache stays honest

A result for a subset of tests must never be reused as a result for the full
suite. The `test` target therefore has one more input: the **test mode**, either
`full` or `affected:<baseline commit>`. A subset result is stored under a key
that says "affected, against this baseline", and only a run in the same mode
against the same baseline can reuse it. Falling back to the full suite under an
"affected" key is safe, because it ran more than the key promises.

## Requirements

:::mara requirement REQ-TEST-RUNNER
:mid: 01M78FHG7F7FAB8GC789E3MHB9
:title: Run tests with cargo test or nextest
:status: accepted
:satisfies: NEED-FAST-TESTS

Each crate has one `test` target. The `testRunner` option selects the runner: `cargo` (the default) runs `cargo test`, and `nextest` runs cargo-nextest. No other target is added for either runner.
:::

:::mara requirement REQ-DOCTESTS
:mid: 01M78FHG7FWPF1WTP90ASPYEMV
:title: Run doctests whenever nextest is the runner
:status: accepted
:satisfies: NEED-CORRECT-CACHE

When the runner is nextest, a crate's `test` task also runs the crate's doctests, and the task succeeds only if both the nextest run and the doctests succeed. This cannot be switched off, so a `test` result means the same thing with either runner.
:::

:::mara requirement REQ-AFFECTED-TESTS
:mid: 01M78FHG7FNTNJW0STSNNP2AF5
:title: Select affected tests inside the test target
:status: accepted
:satisfies: NEED-FAST-TESTS

The `affectedTests` setting declares that a workspace uses selection. It is valid only with the nextest runner; enabling it with another runner fails when the graph is created, with a message naming the two options. In such a workspace a crate's `test` task runs either the tests selected for the current change or the full suite, and reports which of the two it did and why. The environment variable `NX_RUST_TEST_MODE`, set to `affected` or `full`, chooses for a run. Without it, a run selects on a developer's machine and runs the full suite in CI. The full suite also runs when no selection is possible. A single run can force the full suite with `--affectedTests=false`, and a crate can opt out of selection in its metadata.
:::

:::mara requirement REQ-TEST-MODE-KEY
:mid: 01M78FHG7FS5MHY2P1ZPS6D403
:title: Never store a subset result under a full-suite key
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a `test` task includes the [[TERM-TEST-MODE]] and, in affected mode, the commit of the [[TERM-BASELINE]]. A result produced by running a subset of tests is never restored for a task that is to run the full suite, nor for a subset selected against another baseline.
:::

:::mara requirement REQ-SELECTION-SAFETY
:mid: 01M78FHG7F81B81DHEYS6QEQVS
:title: Widen the selection where coverage cannot see a change
:status: accepted
:satisfies: NEED-CORRECT-CACHE

When a change touches a file whose effect on tests the coverage data cannot show, every test of each crate that file belongs to is run. This covers at least `build.rs`, toolchain files, `.cargo/config.toml`, proc-macro source and non-Rust files that tests read. When the selector cannot select at all, the full suite runs.
:::

## Design

:::mara design DES-TEST-MODE
:mid: 01M78FHG7F7NZT1HQM98QHVY34
:title: Test mode as a runtime input
:status: accepted
:satisfies: REQ-TEST-MODE-KEY
:mitigates: RISK-SUBSET-AS-FULL

The `test` target of a workspace that uses selection has a runtime input: a command of the plugin that prints `full` or `affected:<baseline commit>`. Nx hashes its output with the other inputs, so the mode and the baseline are in the key ([[ADR-ONE-TEST-TARGET]]).

The command and the test executor decide the mode by the same rule, from the environment alone ([[ADR-TEST-MODE-CHOICE]]):

1. `NX_RUST_TEST_MODE` set to `full` or `affected` asks for that mode. Any other value fails the task.
2. Without the variable, the mode asked for is `full` where Nx detects CI and `affected` elsewhere.
3. `affected` becomes `affected:<commit>` when a usable baseline exists. Without one the mode is `full`, and the task output says why. The command does not start cargo-affected, whose `status` builds and lists the tests whenever it finds data ([[EVD-CARGO-AFFECTED-COST]]): it reads the commits from cargo-affected's database, `target/affected/coverage.db` in the workspace root whatever the target directory is, without writing to it, and prints them sorted and joined by `,`; where it cannot read them, as after cargo-affected changed its database, the mode is `full`. A baseline that the executor then cannot use runs the full suite under the affected key, which this design allows (below).

The plugin does not look at branches. A pipeline for main that sets nothing is in mode `full`, so the full suite runs once per code state. A pull request pipeline sets `NX_RUST_TEST_MODE=affected`.

`--affectedTests=false` makes the executor run the full suite whatever the mode is. The mode command cannot see the command line, but Nx hashes the options passed there, so that run has a key of its own.

A task in affected mode may run more than its selection, up to the full suite, and still store its result under the affected key. The reverse never happens.

Nx evaluates the command afresh for every task of every run, also under the Nx daemon, in the repository root and with the task's environment: that of the `nx` command and the dotenv files Nx loads for the task ([[EVD-NX-24-INPUT-SEMANTICS]]). The executor decides the mode from the same environment. A batch process lacks the task's own dotenv files, so the batch implementation rebuilds each task's environment before it decides ([[DES-BATCH]]).
:::

:::mara design DES-TEST-RUN
:mid: 01M78FHG7FBRFVSZC9GZW2Q3CQ
:title: One test run
:status: accepted
:satisfies: REQ-TEST-RUNNER
:satisfies: REQ-DOCTESTS
:satisfies: REQ-AFFECTED-TESTS
:satisfies: REQ-SELECTION-SAFETY

With the `cargo` runner, a group's test tasks run as one `cargo test`, which also runs their doctests, where the group selects each crate with `-p` and its package ID specification ([[DES-UNIFICATION]], [[DES-INVOCATION]]). Where the group's strategy builds the whole workspace, its test binaries and its doctests run in steps of their own (**Under `workspace-build`**, below). With `nextest`, one run of a group in affected mode ([[DES-TEST-MODE]]) has five steps, of which steps 1, 3 and 5 are each one cargo command for the whole group ([[DES-BATCH]]):

1. Ask cargo-affected for the selection only: `cargo affected status --report-json <path> --report-detail full -- <the cargo arguments of step 3>`, in the workspace root, with git's `diff.relative` set for that process through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`, added after any that the environment already has. cargo-affected compares the paths that `git diff` names from the top of the repository with coverage paths relative to the workspace root, and in a workspace below the top it selected nothing ([[EVD-CARGO-AFFECTED-REPORT]]). The report is used only where all of the following hold; in every other case the group runs its full suite, and each task's output gives the reason.
   - cargo-affected exits with 0, the report's `schema_version` is 1, `cache.status` is `hit-exact` or `hit-with-divergence`, and `selection.selected_tests` is a list. An unknown status counts as a refusal. The reason given is the status, with the `differing_labels` of `cache.stored_fingerprints[0]` for `miss-fingerprint`, or cargo-affected's exit status and the end of its standard error.
   - **Context.** The baseline has the plugin's record of the context it was collected in ([[DES-BASELINE]], [[ADR-AFFECTED-BASELINE-CONTEXT]]), and the group's context equals it: the cargo options of step 3 that change what is compiled or run, namely `--features`, `--all-features`, `--no-default-features`, the profile and `--target`, the target triple that cargo builds for, and, for every environment input of each task of the group ([[DES-INPUTS]]), those the plugin infers, the variables of the prefixes its list names and those that `envInputs` declares, the hash of the value, an unset variable counting as a value of its own. The reason names each option or variable that differs, or says that the record is missing.
   - **Changed files.** The plugin asks git itself for the changed files of the whole repository, from the top of the repository, with `core.quotePath=false` and NUL-separated output, against every collection the report rests on: for each commit of `cache.collect_shas` whose `relation` is `equal` or `reachable`, `git diff --raw --no-renames -z <commit>`, which compares that commit with the working tree, staged and unstaged changes alike, and once `git ls-files --others --exclude-standard -z` for the untracked files that git does not ignore. Their union is the set of changed files that step 2 works on. A rename counts as both its paths and a deleted file as its path, and neither has to exist. An entry for a submodule, of mode `160000`, runs the full suite, because git does not name the files that changed inside it. So does a file that git ignores and that a `fileInputs` pattern of a task of the group matches, as `git ls-files --others --ignored --exclude-standard` lists it, because git cannot say whether it changed. Every changed file inside the workspace folder, other than a `.profraw` file, which cargo-affected leaves out, must appear in `selection.changed_files` by its path relative to the workspace root, so that a mismatch of paths fails safe.

   Each selected test is named by `binary_id` and `test_name`, and belongs to the member whose package name is the part of `binary_id` before the first `::`; the plugin keeps the tests of the group's crates that do not opt out, because the report lists tests of other crates too, also where it was given `-p`.

2. Widen where coverage cannot show a change's whole effect ([[ADR-AFFECTED-TESTS-WIDENING]]). Coverage narrows a changed file only where its whole effect on tests runs through code that coverage records at run time, in the same context as the baseline: a `.rs` file inside the workspace folder that `selection.changed_files` lists with `tracked_by_coverage: true`, that lies in the folder of a member that is not a proc-macro crate, the deepest such folder, and that is neither the member's build script, the file of its `custom-build` target or a folder of its own that holds that file such as `build/`, nor matched by a `fileInputs` pattern of any crate. Every other changed file widens, whatever its coverage rows say: a build script and the files that crates declare, every source file of a proc-macro crate, every file other than Rust source, such as data files, snapshots, templates, toolchain files, Cargo configuration files and what they include, and `.config/nextest.toml`, a Rust file without rows, and every file outside the workspace folder. Such a file adds every test of each crate of the group whose `test` task has it among its inputs ([[DES-INPUTS]]), the dependency sources reached through `^` included, so that the crates that depend on its crate are added too. A changed file that is an input of no crate of the group adds nothing. Where the plugin cannot match a changed file against a task's inputs, as with a named input or a pattern of the repository's own `inputs` that it does not resolve, the group runs its full suite. Where a changed file is among the inputs of the `test` task of a member with a binary target, whether it widens or narrows, that member runs every test of its integration test targets, which can start its binaries through `CARGO_BIN_EXE_<name>`. Every member of the group that depends on that member, by a Cargo dependency of any kind, an Nx dependency or a declared input that reaches its folder, runs all its tests, because coverage of a program that a test starts is not attributed to the test. A test that starts a program without any such relation is outside what the plugin can see; its cache key misses that program already without affected mode.
3. Run one `cargo nextest run` for the group. The selection is passed in `-E` arguments, which nextest unites and intersects with the repository's default filter, each of the form `(<group's filterset>) & (<part of the selection>)`; a part is `binary_id(=<id>) & (test(=<name>) | …)` for the tests of one binary, a crate that step 2 adds or that opts out is `package(=<name>)`, and `\`, `/`, `)` and `,` in a name or ID are escaped with `\`. No argument exceeds 64 KiB, because Linux refuses one of more than 128 KiB; where the arguments together would exceed 512 KiB, each part names its binary only, `binary_id(=<id>)`, which runs more tests and never fewer. A configuration file cannot carry the selection: a `default-filter` in the plugin's tool configuration yields to one in the repository's configuration, and nextest then ran what the repository's filter allowed ([[EVD-CARGO-AFFECTED-REPORT]]). Where the selection of a group is empty after step 2, step 3 is left out, and each task reports 0 selected tests. Under `workspace-build` it selects as **Under `workspace-build`** says.
4. Map nextest's per-test results back to crates, so each Nx task gets its own result and cache entry: a JUnit suite is named by the binary ID, which maps to a member as in step 1.
5. Run the doctests with one `cargo test --doc`, because nextest does not run them. It selects crates as step 3 does, with `-p`, or under `workspace-build` as below; cargo skips crates without a library, and the step is left out where none has one. Its results are attributed to crates as those of `cargo test` are, below.

In mode `full`, and in a workspace without `affectedTests`, steps 1 and 2 are skipped and step 3 runs every test of the selected crates. When cargo-affected falls back to the full suite, the task output says so and gives the reason. The doctests are not narrowed: in affected mode too, each task that runs also runs all doctests of its crate.

**Attributing the output of `cargo test`.** `cargo test` with the `cargo` runner and the doctest step pass `--no-fail-fast`. When a test has failed, cargo then ends with a list of the failed targets, each with the `-p <package>` and the target flag that rerun it, such as `` `-p other --doc` ``, and it prints the same after each failing target. The list identifies the package: members of a workspace have distinct package names, and the list names a member by its bare name even where a crate outside the workspace has the same name and the command selected the member by its package ID specification ([[DES-INVOCATION]], [[EVD-CARGO-PACKAGE-SPECS]]). The headers of the blocks do not identify it: `Running unittests src/lib.rs (…/good-…)` and `Doc-tests good` name the library or test target, which two packages can share ([[EVD-CARGO-BATCH-FAILURES]]). A task passes the step when cargo exits successfully, or when cargo has printed that list and the list names no target of the task's package; under `workspace-build` the test binaries' step is decided by cargo's JSON messages and the runner's record instead (**Evidence for test binaries**). The plugin relies on cargo printing that list after every test and doctest has ended, as the last lines of its standard error. It reads only that last list, and only where cargo exits with another status than 0; where cargo exits so and its standard error does not end with a list, every task of the step fails. A list that a test or a doctest prints, as a nested cargo whose output a test passes on does, comes before cargo's and is not read; a doctest's output reaches cargo's standard error too where `RUST_TEST_NOCAPTURE` or `--nocapture` lets it through, and cargo's list still came last ([[EVD-TEST-STEPS-SPLIT]], [[EVD-TEST-STREAM-AND-NEXTEST]]). No line that a test prints can come after cargo's list, so that such a line can at most fail tasks. Under `--workspace` in a workspace with one member, cargo leaves out `-p`, as in `` `--doc` ``; such an entry names that member. Otherwise, as after a compile error, the output shows no result for the task, and it fails ([[DES-BATCH]]). A task is never reported successful when the output cannot show that its own package's tests passed: where the output cannot tell which of several packages a result belongs to, every task it could belong to fails, and the message says why. A block of output that the plugin cannot attribute to one package goes into the terminal output of every task it could belong to.

**Under `workspace-build`.** Cargo cannot leave out whole crates without resolving features for the rest: `-p` and `--workspace --exclude` both narrow them ([[EVD-WORKSPACE-TEST-SELECTION]]). Where the group's strategy builds the whole workspace, as `workspace-build` does and `hakari` where it falls back to it, every step therefore selects `--workspace`, however many tasks the group holds, one included ([[DES-BATCH]]). The group's test binaries run through a selecting runner whose record shows which of them ran, and its doctests run for the whole workspace with a plain `cargo test --doc`, of whose results the plugin keeps those of the group's crates ([[ADR-TEST-SELECTING-RUNNER]]). With the `cargo` runner the group has three steps:

1. **Build.** `cargo test --workspace --no-run` compiles what plain `cargo test` compiles apart from the doctests: every test executable, the binaries that integration tests use, and every example, also one without `test = true`, which plain `cargo test` builds without running it ([[EVD-TEST-STEPS-SPLIT]]). A compile error stops the step and fails every test task of the group ([[DES-BATCH]]).
2. **Test binaries.** `cargo test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics --config 'target.<host>.runner=[…]'`. `<host>` is the host's triple as `rustc -vV` names it in the workspace root with the group's environment, and the list starts the selecting runner of **The runner program**, with absolute paths in TOML strings. `--tests` runs the targets with `test = true`, which are those that plain `cargo test` runs besides its doctests: the library's unit tests, the binaries, the integration tests, `harness = false` ones included, and the examples and benches with `test = true`; `--lib --bins` would also run a library or a binary with `test = false`. After step 1 the step compiles nothing. With `json-render-diagnostics`, cargo still renders compiler diagnostics on its standard error as it does without it, and writes its messages as JSON on its standard output, where the tests' own output follows them.
3. **Doctests.** `cargo test --workspace --doc --no-fail-fast`, without the runner and without any wrapper, so that cargo and rustdoc decide every doctest as plain `cargo test` does (**Doctest results**). The step is left out where no crate of the group has a library.

With nextest, step 3 of the run above is `cargo nextest run --workspace --no-fail-fast --no-tests=pass --tool-config-file nx-rust:<file>` with the filterset `package(=a) | package(=b)` of the group's package names, passed with `-E` and in affected mode intersected with the selection in each `-E` argument as step 3 says; nextest builds as `cargo test --no-run` does, examples included, and starts no test of another crate. `=` makes each name match exactly, and `--no-tests=pass` stays, because a group's filterset can match a crate without tests, for which nextest would otherwise fail with exit code 4. nextest needs no runner of the plugin: it starts every test as a process of its own and judges it by its exit status, and a test binary that cannot be started or loaded fails the run, as one whose library could not be loaded did with exit code 104 ([[EVD-TEST-STEPS-SPLIT]]). It exits with 0 where every test that it ran passed and with 100 where one failed.

**nextest's configuration.** The repository's nextest configuration applies as it does for a plain `cargo nextest run`: the workspace's `.config/nextest.toml`, the profile that `NEXTEST_PROFILE` chooses, and that profile's `default-filter`, retries and other settings. The control plane decided on 14 November 2026 under [[REQ-CARGO-UNCHANGED]], of which the maintainer is told, that a `test` task with the nextest runner runs the tests that nextest runs for its crate under the repository's configuration, no more: with a `default-filter` that leaves out a failing test, the task passes as plain nextest does. `--ignore-default-filter`, which would run tests that the repository leaves out, was the option not taken. The plugin passes no `--profile`: an earlier form of the command chose a profile of the plugin's own, which overrode `NEXTEST_PROFILE`, so that with a profile `ci` that runs a failing test it skipped that test and exited with 0 where plain nextest failed ([[EVD-TEST-STREAM-AND-NEXTEST]]). The plugin's tool configuration file sets only `junit.path` of the `default` profile, to a file in a folder of the plugin's own, which every profile inherits unless it sets its own; nextest gives the repository's configuration precedence over a tool configuration, so that the file adds the report and changes no test that runs. Where the repository's profile sets its own JUnit path, nextest writes the report there and not to the plugin's file; the plugin then has no report, and where nextest exits with 100, every task of the group fails, with a message that says why. The configuration reaches the keys: `.config/nextest.toml` is an input of `test` with the nextest runner, and so is every variable whose name starts with `NEXTEST_` ([[DES-INPUTS]]), so that a changed filter or profile changes the keys; nextest's user configuration in the home folder sets display options only. Each task's terminal output holds nextest's own lines on how many tests ran and how many the configuration skipped, such as `Starting 2 tests across 3 binaries (1 test skipped via profile.default.default-filter)` and its summary, and the number of its crate's tests that the report holds, so that a crate whose tests the configuration skips shows 0 tests run; the report lists only the tests that ran.

Step 4 takes the result of each test from nextest's JUnit report, one suite per test binary; nextest's JSON messages for a run are experimental and not used. A task passes step 3 where nextest exits with 0, or with 100, which nextest gives where a test failed, where the report holds no failed test of its package; with any other status, as after a build that failed, every task of the group fails. Step 5 is the doctest step above.

**The selecting runner.** Cargo starts the runner for every test executable of step 2, with the program and its arguments as its arguments, in the package's folder and with the package's name in `CARGO_PKG_NAME` ([[EVD-WORKSPACE-TEST-SELECTION]]). The plugin gives it the group's crates in the variable `NX_RUST_TEST_PACKAGES`, their package names between colons, such as `:api:core:`, since a package name holds neither a colon nor white space. A package name identifies a crate here, because cargo runs the tests of members only and members have distinct package names ([[DES-INVOCATION]]). For each start, the runner:

1. **Records the start before anything else.** It creates a file of its own, exclusively, in the folder that the variable `NX_RUST_TEST_RECORD` names, which the plugin creates for the step and removes after it, naming the package as `CARGO_PKG_NAME` gives it and the program's path. Where it cannot, it says so on standard error and exits with 125, having started nothing.
2. **Fails closed.** Where `CARGO_PKG_NAME` is missing or empty, no program is given, or `NX_RUST_TEST_PACKAGES` is missing or not of that form, it adds an error entry that names the cause, says it on standard error and exits with 125.
3. **Skips another package.** For a package that is not in the list, by exact comparison of names, it adds a skip entry and exits with 0.
4. **Runs a package of the list.** It starts the program with its arguments and with the environment that cargo gave it, less its own two variables, so that the test gets cargo's environment, `[env]` of Cargo's configuration included, as under plain cargo. When the program ends, it adds an end entry with its exit status, or the signal that ended it, and ends with the same status, or by the same signal. Where it cannot add the end entry, it exits with 125.

**Evidence for test binaries.** The plugin takes step 2's result only from cargo's JSON messages, the record and cargo's exit status, never from a line that cargo writes for people or that a test writes. Cargo writes one `compiler-artifact` message with `executable` and `profile.test` for every test executable that it runs, fresh or rebuilt, with its `package_id`, also with `CARGO_TERM_QUIET` and `CARGO_TERM_VERBOSE` set, which take away cargo's `Running` lines or put the runner's command in place of the path ([[EVD-TEST-STEPS-SPLIT]]). The stream is not only cargo's: a proc macro, which runs inside the compiler, can write lines to it while a crate that uses it is compiled, and a test while it runs. A proc macro's `{"reason":"build-finished","success":true}` came before the artifact message of a test executable on both versions, and a reading that stopped at the first `build-finished` then expected nothing and passed a task whose test never ran ([[EVD-TEST-STREAM-AND-NEXTEST]]). Nothing in the stream therefore ends the reading: every `compiler-artifact` message with `executable` and `profile.test` anywhere in the command's standard output adds an expected executable, so that a line that is not cargo's can only add an expectation, and so fail a task, never remove one. The control plane decided on 14 November 2026, of which the maintainer is told, to accept that a proc macro or a test that prints a forged artifact message fails a good run. The build counts as failed where any `build-finished` message reports `success: false` or none appears, so that a forged one can fail the step's tasks and not pass them; an artifact message whose `package_id` is no member's fails every task of the step, because cargo runs no test of another package. Step 2's stream gives the expected set, not step 1's: it is the command whose runner starts the record holds, it names every executable that it runs, and step 1 named the same executables in every experiment, so that taking its stream as well would add a second stream that compiled code can write into and no executable ([[EVD-TEST-STREAM-AND-NEXTEST]]). A package's test executables are those whose `package_id` is the package's `id` in the `cargo metadata` report ([[DES-INVOCATION]]). A task passes step 2 only where:

- no `build-finished` message reports a failure, at least one appears, and the record folder can be read; otherwise every task of the step fails;
- every test executable of its package has exactly one record, of that program, compared by real path, and of its package, and that record ends with the status 0.

A record that ends with another status or a signal is a failed test binary: libtest ends with 101 when a test failed, and a program that the loader cannot load ends with 127, which cargo reports as a failed target as well ([[EVD-TEST-STEPS-SPLIT]]). Where cargo exits with another status than 0 while no failed build and no record explains it, every task of the step fails: what the plugin cannot explain counts as a failure. Each way in which a selected test binary can fail to run ends in a failed task: a runner that cannot start, or that ends with 0 before it records anything, as under a preload in `NODE_OPTIONS`, leaves executables without a record; a runner that cannot record has started nothing; one that is killed after its start leaves no end; a list that is not of the right form leaves error entries; and a program that cannot be loaded ends with 127. Nothing of this reads a line that cargo writes for people or that a test writes, so that terminal settings, a nested cargo whose output a test passes on, and a test that prints a line shaped like cargo's cannot change a task's result. A test binary of a crate outside the group never runs.

**Doctest results.** Step 3's result for a task comes from cargo, as for a plain `cargo test --doc`: where cargo exits with 0, every doctest passed; otherwise the task passes the step where cargo's list of failed targets names no `--doc` target of its package (**Attributing the output of `cargo test`**), and where cargo exits with another status without the list, as after a library that does not compile, every task of the group fails ([[DES-BATCH]]). The last list on cargo's standard error is cargo's: a doctest that printed a list of that form did not change it, on standard output where rustdoc keeps a doctest's output and on standard error where `RUST_TEST_NOCAPTURE` or `--nocapture` lets it through, nor did `CARGO_TERM_QUIET` or `CARGO_TERM_VERBOSE`, with which cargo still printed it ([[EVD-TEST-STEPS-SPLIT]], [[EVD-TEST-STREAM-AND-NEXTEST]]). A failing doctest of a crate outside the group fails no task: each task of the group gets a warning that names the crate ([[DES-DIAGNOSTICS]]). Rustdoc decides every doctest as without the plugin: merged edition-2024 doctests keep a process each, and a `should_panic` doctest that ends with `std::process::exit` or an abort passes, as under plain cargo. The step runs the doctests of every library of the workspace, so that those of crates outside the group take time and can have side effects or hang the step; their results are discarded, and a task's result, and with it what its key promises, is that of its own crate's doctests. Rustdoc compiles every doctest whether or not it then runs it: in the research's workspace all doctests took 1.35 s without a runner against 1.45 s with a runner that skipped those of other crates ([[EVD-WORKSPACE-TEST-SELECTION]]), and on a workspace with 504 doctests the two designs could not be told apart on a loaded machine ([[EVD-TEST-STEPS-SPLIT]]).

**What each task shows.** A task's terminal output holds what concerns its own crate, as far as cargo's output tells: the compiler's messages about it; in step 2 the output after cargo's `Running` line for one of its executables, whose path the JSON names; and in step 3 the block after a `Doc-tests` header that names its library. Output that the plugin cannot attribute to one package, such as all test output where `CARGO_TERM_QUIET` leaves out the headers, or a block whose header names a library that several members have, goes into the terminal output of every task it could belong to; it decides no result. What concerns only crates outside the group is left out: the `Running` line of a skipped executable, and the doctest blocks of other crates, apart from the warning about a failing one. A compile error in a crate outside the group stops the build step and fails every task of the group, with the message of [[DES-BATCH]].

**The runner program.** The runner is a Node script in the plugin's package, started as `["<node>", "<script>"]` with the Node that runs the batch implementation, by absolute paths, on Linux and on macOS. Only test executables go through it, one start for each test executable of the workspace, which cargo runs one after another: with 42 of them on a machine under load, the Node runner took 1.26 to 1.71 s, against 34 to 77 ms without a runner and 114 to 161 ms with a `/bin/sh` script ([[EVD-TEST-STEPS-SPLIT]]). The maintainer chose Node on 14 November 2026 all the same, as the control plane proposed: "Node on Linux and macOS (Recommended)", the option not taken being `/bin/sh` on Linux with Node on macOS. Node passes cargo's environment on exactly, and the shell did not: bash as `/bin/sh` rewrote `SHELLOPTS` and `BASHOPTS` into its own lists of options, where plain cargo gives the test the values of the environment and of `[env]`, and the plugin cannot hand back cargo's values, since `[env]` applies them after the plugin has started cargo. On macOS the system also removes `DYLD_*` variables when it starts a binary that System Integrity Protection protects, such as `/bin/sh`, while cargo passes a test's library path in `DYLD_FALLBACK_LIBRARY_PATH` there; Node is no such binary ([[RISK-TEST-RUNNER-MACOS]]). Options that `NODE_OPTIONS` gives apply to the runner as to every Node process, and the plugin leaves them in place: one that keeps Node from starting, or a preload that ends it before it records anything, fails the group's tasks through the evidence, with a message that names the runner's command and `NODE_OPTIONS`. The script starts nothing through `PATH`. The runner is given on the command line only and never written into a configuration file ([[REQ-CARGO-UNCHANGED]]), and neither it nor its variables change a fingerprint: cargo compiled nothing between runs with and without them, on both versions.

**A runner the user configured.** A runner given on the command line does not chain to one that the user configured. Cargo 1.100.0 replaces it. Cargo 1.91.0 appends the plugin's runner to a list from a configuration file as further arguments, fails where the file gives the runner as a string, and keeps the runner of `CARGO_TARGET_<TRIPLE>_RUNNER` in place of the plugin's ([[EVD-WORKSPACE-TEST-SELECTION]]). The plugin cannot ask cargo which runner applies, because `cargo config get` is nightly-only, and reading it as cargo does would take more than the files and variables: `include`, which Cargo 1.91 ignores and rejects in table form while Cargo 1.100 rejects it as a plain string; `cfg(…)` tables matched against the host's configuration with the command's flags, since a `--cfg` in `RUSTFLAGS` made a table apply; and cargo's error where several such tables match, which a runner on the command line hides. The control plane decided on 14 November 2026, of which the maintainer is told, against reading the user's runner and calling it from the selecting runner, because no reading could be shown to give what cargo uses in every case on both versions. Where a runner for the host is or may be configured, the group's `test` tasks instead run one crate per cargo command, each step selecting its crate with `-p` and without the selecting runner, so that the user's runner applies as in a plain `cargo test -p`, and rustdoc treats the doctests as it does with that runner under plain cargo, merged ones in one process included ([[DES-BATCH]], "Groups of one crate"); the keys of `workspace-build` are a superset of what such a command depends on. The batch implementation decides this when it forms the groups, with the group's environment and the files as they are then, and counts a runner as configured where:

- the environment has `CARGO_TARGET_<HOST>_RUNNER`, with the host's triple in capitals and `-` and `.` replaced by `_`, whatever its value;
- a configuration file that cargo may read for a command in the workspace root sets `runner` in the table `target.<host triple>`, or in any table under `target` whose key starts with `cfg(`, whether or not its expression matches the host. The files are `.cargo/config` and `.cargo/config.toml` in the workspace root and in each folder above it, both where both exist; `config` and `config.toml` in the Cargo home that `CARGO_HOME` in the group's environment names, or else in `.cargo` in the home folder; and every file that one of them adds with `include`, in any form and whatever the cargo version, with paths taken from the folder of the file that includes it;
- such a file exists and cannot be read or parsed, so that whether it sets a runner is unknown.

A task's own command passes cargo no `--config`, since no option of `test` adds arguments to cargo ([[DES-TARGET-COMMANDS]]). Each task that runs alone for this reason says so at the top of its terminal output and names the variable or file. The files inside the repository and the `CARGO_TARGET_` variables are inputs of every key ([[DES-INPUTS]]), so adding or removing such a runner changes the keys; a runner in a file outside the repository is in no key, as nothing of such a file is, and the warning for a configuration file that Nx does not hash names that file ([[RISK-HOST-ENVIRONMENT]]).

cargo-affected only selects. nextest runs the tests, and the selector is a replaceable step ([[ADR-TEST-SELECTOR]]). A crate that opts out of selection, with `affectedTests = false` among the options of its `test` target ([[DES-PLUGIN-OPTIONS]]), always contributes all its tests. Rules for non-Rust inputs such as SQL files, snapshots and templates can be added per repository; there are none by default.

The report gave what steps 1, 3 and 4 need on ripgrep, tokio and a fixture: nextest ran exactly the selected tests and every result mapped to its crate ([[EVD-CARGO-AFFECTED-REPORT]]). Step 1 builds the test binaries that step 3 then uses, because cargo-affected lists the tests through `cargo nextest list` with the same arguments, so its own cost is the listing and the database: 0.14 to 0.16 s on ripgrep and 0.6 to 1.4 s on tokio with a warm build directory, against full suites of 1 s and 15 s ([[EVD-CARGO-AFFECTED-COST]]). Code that another crate evaluates while it compiles, such as a `const fn` used in a `const` or a macro by example, leaves no coverage for that crate's tests; this is the one change that step 2 does not widen, and it stays a stated limit ([[ADR-AFFECTED-TESTS-WIDENING]], [[RISK-CARGO-AFFECTED]]).
:::

:::mara design DES-TEST-PHASES
:mid: 01M78FHG7F64P52Y7055J0MYAC
:title: Separate build and run phases in the test executor
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK

Inside the test executor, building the test binaries and running them are separate phases with a defined hand-over between them. v1 runs both on one machine in one task. The split is the seam for a later distributed mode, in which one machine builds and archives the test binaries and other machines only run them ([[ADR-SINGLE-MACHINE]]).
:::

## Scenario

:::mara scenario SCN-AFFECTED-TESTS-PR
:mid: 01M78FHG7F09P5FKTNA826FM36
:title: A pull request runs only the tests its change affects
:status: accepted

A workspace uses nextest with `affectedTests`, and CI keeps a coverage baseline for main. A developer changes one function in a large crate and opens a pull request. The pull request pipeline sets `NX_RUST_TEST_MODE=affected`, restores the baseline for the pull request's base commit and runs `nx affected -t test`. The crate's `test` task is in mode `affected:<base commit>`: cargo-affected selects the tests that executed the changed function, nextest runs them together with the crate's doctests, and the result is stored under the affected key. Crates the change cannot reach are not run at all. After the merge, the main pipeline, which does not set the variable, runs the crate's `test` task in mode `full`, which the affected-mode result cannot satisfy, so the whole suite runs once and the baseline is updated.
:::
