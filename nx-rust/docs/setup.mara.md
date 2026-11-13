# Setup and compatibility

> **Status:** `nx add`, the `library` and `binary` generators and the checks of
> the Nx and Cargo versions are implemented. `init` stops for each problem that
> graph creation detects so far: an unsupported Nx or Cargo, a missing cargo, a
> failing `cargo metadata` and two crates with one project name.
> Of the tools below it counts only cargo-deny as needed by your settings.
> Apart from the one for a newer Nx with `NX_RUST_ALLOW_UNSUPPORTED_NX`, the
> warnings are not implemented yet, and neither are the errors of a task for a
> missing tool, which need the targets that run the tools. The package is not
> published to npm yet.

## What you need

|       | Supported       |
| ----- | --------------- |
| Nx    | 24              |
| Cargo | 1.91 and later  |
| Host  | Linux and macOS |

Windows hosts are not supported in v1. With an older Nx or Cargo the plugin
stops with an error that names the version it found and the one it needs. A
later Nx major is added once the plugin's end-to-end tests pass on it. Until
then that major stops the plugin in the same way. To try it anyway, set
`NX_RUST_ALLOW_UNSUPPORTED_NX=true`: the plugin continues with a warning, but
nobody has checked its cache keys and batching on that major.

macOS is supported, but for the moment the plugin's own CI runs on Linux only,
so macOS is not tested automatically yet ([[ADR-CI-LINUX-ONLY]]). Please report
anything that behaves differently there.

The plugin installs nothing. These tools are yours to install, and only when
you use the feature that needs them:

| Tool                                                                | Needed for                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A Rust toolchain: `cargo` and `rustc` on `PATH`, with rustup or not | Everything                                                                         |
| [cargo-nextest](https://nexte.st)                                   | `testRunner = "nextest"`                                                           |
| [cargo-affected](https://github.com/max-sixty/cargo-affected)       | `affectedTests = true`                                                             |
| [cargo-hakari](https://docs.rs/cargo-hakari)                        | The `hakari` feature-unification strategy                                          |
| [cargo-audit](https://crates.io/crates/cargo-audit)                 | The `audit` target                                                                 |
| [cargo-deny](https://crates.io/crates/cargo-deny)                   | The `deny` target, which a workspace has only with a cargo-deny configuration file |
| The `wasm-bindgen` CLI and the wasm target                          | `wasm-build`                                                                       |
| The napi CLI                                                        | `napi-build`                                                                       |

When one is missing, the task that needs it fails with a message that says which
tool, which feature asked for it, and how to get it. `nx add` tells you
beforehand which of them your settings need.

Every machine that runs `nx` in the repository needs cargo, also one that only
works on JS projects: Nx asks Cargo for the crates whenever it builds the
project graph. Without cargo the graph fails with a message that says so. The
plugin does not leave the Rust projects out instead, because that machine would
then compute other cache keys than everyone else.

## Adding the plugin

```sh
nx add @convesoft/nx-rust
```

Nx first installs the package, which adds it to your `package.json` and
lockfile, and then runs the plugin's `init` generator. `init` registers the
plugin in `nx.json` and changes nothing else in your repository: no crate, no
Cargo manifest, no `.cargo/config.toml`.

Before it registers anything, `init` checks the repository the way Nx will once
the plugin is active. If Nx could not build the project graph, for example
because cargo is not installed or two crates have the same name, `init` stops
with that error and `nx.json` stays as it was. The package stays installed. Fix
the problem and run `nx add @convesoft/nx-rust` again.

Then it reports what it found:

- tools from the table above that your settings need and that are missing, as
  warnings, and tools that are missing but not needed by your settings, on one
  line. cargo-audit is always on that line when it is missing, because no
  setting asks for `audit`; an `audit` task still needs it;
- the warnings that building the graph gives, such as a `target` folder that Nx
  does not ignore;
- each Cargo workspace whose build directory is inside the repository, with the
  setting that moves it out ([Caching](caching.mara.md#cargos-two-directories)).
  `init` does not write that setting for you.

In a repository without any `Cargo.toml`, it registers the plugin and tells you
how to create your first crate. Running it again leaves your plugin entry in
`nx.json`, options included, as it is, and prints the report again.

Afterwards:

```sh
nx show projects          # your crates are listed
nx graph                  # with their dependencies
nx run-many -t lint test  # Rust and JS together
```

To add the plugin by hand, put it into `nx.json`:

```json
{
  "plugins": ["@convesoft/nx-rust"]
}
```

## Creating crates

```sh
nx g @convesoft/nx-rust:library rust/crates/core
nx g @convesoft/nx-rust:binary rust/crates/cli --name my-cli
```

| Option      | Meaning                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `directory` | The crate's folder, the first argument. As with Nx's own generators, it is relative to the folder you run `nx` in. |
| `--name`    | The package name. Without it, the crate is named after its folder.                                                 |
| `--edition` | The Rust edition. Without it, the crate takes the workspace's `edition`, or Cargo's default.                       |

Both run `cargo new --vcs none` in that folder, and Cargo adds the crate to the
members of the workspace around it unless a glob already covers it. The result
is what `cargo new` gives you, so a crate you create with plain `cargo new`
works just as well: the plugin finds it on the next run.

- Outside every Cargo workspace the crate is a standalone crate, with its own
  `Cargo.lock` and build directory, and the generator says so.
- In a folder that the enclosing workspace lists under `exclude`, the generator
  stops instead of overriding your `exclude`.
- `--dry-run` prints the cargo command and changes nothing.

If you run `cargo new` yourself, pass `--vcs none` when the folder above the new
crate does not exist yet. Otherwise Cargo creates a git repository inside the
crate, even within your repository.

Migrating from `@monodon/rust` is not part of v1.

## Error messages and warnings

Each message says what is wrong, where (the crate, workspace, manifest, option
or tool) and what to do. Messages have no error codes.

- An error found while Nx builds the project graph stops every Nx command that
  requires the project graph, JS tasks included, until it is fixed. The plugin
  never leaves a crate out to get past it.
- A missing tool fails only the task that needs it.
- A warning found while Nx builds the graph is printed there, but on your
  machine the Nx daemon builds the graph in the background and writes it to its
  log (`.nx/workspace-data/d/daemon.log`). So the plugin prints the warning
  again when a task of the crate concerned runs, and `nx add` prints it too.
  `NX_DAEMON=false` shows it directly.

Keep Cargo's folders out of what Nx sees. Apart from a few fixed folders such
as `node_modules`, Nx ignores only what `.gitignore` and `.nxignore` say, so a
`target` folder that neither covers is hashed with your sources, and the plugin
warns about it. Either file will do:

```gitignore
target/
```

## Requirements

:::mara requirement REQ-COMPATIBILITY
:mid: 01M78FHG7FES2FR7DNAAPSDVWE
:title: Support Nx 24, Cargo 1.91+, Linux and macOS
:status: accepted
:satisfies: NEED-EASY-SETUP

The plugin works with Nx 24 and with Cargo 1.91 and later, on Linux and macOS hosts. A later Nx major is supported from the release whose end-to-end suite has passed on it, and the package's peer dependency range names exactly the supported majors. With an older Nx or Cargo the plugin stops with an error that names the version found and the version required, instead of continuing with reduced behaviour. With an Nx major newer than the supported ones it stops in the same way, unless `NX_RUST_ALLOW_UNSUPPORTED_NX` is set to `true`, in which case it continues with a warning that names the major found and the supported majors.
:::

:::mara requirement REQ-INIT
:mid: 01M78FHG7FCBH4HM2R3S09S9KV
:title: Set up the plugin with nx add
:status: accepted
:satisfies: NEED-EASY-SETUP

`nx add @convesoft/nx-rust` registers the plugin in `nx.json` and reports the tools that the repository's configuration needs and that are missing. It writes nothing into crates.
:::

:::mara requirement REQ-CRATE-GENERATORS
:mid: 01M78FHG7F7C38X583EWPV1J5J
:title: Generate library and binary crates
:status: accepted
:satisfies: NEED-EASY-SETUP

A `library` generator and a `binary` generator each create a crate with `cargo new` and add it to the members of the Cargo workspace it is created in. The result is the same as running `cargo new` and editing the workspace manifest by hand.
:::

:::mara requirement REQ-DIAGNOSTICS
:mid: 01M78FHG7FGW9BB3M4MCE52PEG
:title: Say what is missing and how to fix it
:status: accepted
:satisfies: NEED-CLEAR-FAILURES

When a required toolchain or tool is missing, a version is unsupported, or options contradict each other, the plugin fails with a message that names what is wrong, the crate, workspace or option concerned, and what the user can do. It does this at the earliest point where the problem can be known, and it never installs anything itself. A problem found while the graph is created stops graph creation: the plugin does not leave a workspace or a crate out of the graph to get past it. The one exception is an Nx major newer than the supported ones while `NX_RUST_ALLOW_UNSUPPORTED_NX` is `true`, which the plugin reports as a warning before it continues ([[REQ-COMPATIBILITY]]).
:::

:::mara requirement REQ-NO-MANIFEST-WRITES
:mid: 01M78FHG7F8PRTX5Q1T77QNQ1K
:title: Write Cargo files only when asked to
:status: accepted
:satisfies: NEED-CARGO-UNCHANGED

The plugin does not write `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml`. The exceptions are generators, release, and tasks that the user runs in order to change those files, such as a lockfile update. Cargo's own update of `Cargo.lock` during a command the plugin runs, which the same plain cargo command would make as well, is not a write of the plugin. That includes the update that the lockfile task's `cargo update --workspace` makes before a run's crate tasks, which their own cargo commands would make in the same way ([[DES-LOCKFILE-HASHING]]). With the `locked` option the plugin's commands cannot make it.
:::

## Design

:::mara design DES-GENERATORS
:mid: 01M78FHG7FWY1P7FPVC6ZYA9ND
:title: Generators
:status: accepted
:satisfies: REQ-INIT
:satisfies: REQ-CRATE-GENERATORS

**`init`**, which `nx add` runs after Nx has installed the package. In v1 it takes no options of its own: it registers the plugin and reports. Options can be added later without breaking anything. The only change `init` makes is the plugin entry in `nx.json`. It works in three steps.

1. **Check.** It runs the checks that graph creation runs once the plugin is registered ([[DES-DIAGNOSTICS]]): the Nx version and, for the `Cargo.toml` files that Nx would hand the plugin, cargo, the Cargo version and toolchain of each workspace, each workspace's `cargo metadata` report and the project names. A problem that would stop graph creation stops `init` before it writes anything, with the message graph creation would give. A registered plugin whose graph fails stops every Nx command that requires the project graph, the tasks of JS projects and `nx g` included ([[EVD-NX-24-SETUP]]). In a repository without any `Cargo.toml`, only the Nx version is checked and no cargo runs.
2. **Register.** It adds the plugin to `plugins` in `nx.json`. When `nx.json` lists the plugin already, that entry, with whatever options the user set, stays exactly as it is, and `init` still runs its checks and prints its report.
3. **Report.** It prints, without writing anything:
   - the warnings that graph creation gives ([[DES-DIAGNOSTICS]]);
   - each tool of the table below that the repository's configuration needs and that is missing, as a warning that names the tool, what needs it and how to get it;
   - the tools of the table that are missing and that nothing in the repository needs, on one informational line marked "not needed by your settings";
   - each workspace whose build directory lies inside the repository, with the `build.build-dir` setting that the caching guidance suggests. `init` never writes that setting: where Cargo keeps its files stays the repository's choice ([[DES-BUILD-DIRS]], [[EVD-CARGO-DIRECTORIES]]);
   - in a repository without any `Cargo.toml`, how to create a crate.

| Tool                                       | Needed when                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cargo-nextest                              | A workspace uses the nextest runner ([[DES-TEST-RUN]])                                                                                                    |
| cargo-affected                             | A workspace has `affectedTests` on ([[REQ-AFFECTED-TESTS]])                                                                                               |
| cargo-hakari                               | A workspace uses the `hakari` strategy ([[DES-UNIFICATION]])                                                                                              |
| The `wasm-bindgen` CLI and the wasm target | A crate has a `wasm-build` target ([[DES-ARTIFACT-STEPS]])                                                                                                |
| The napi CLI                               | A crate has a `napi-build` target ([[DES-ARTIFACT-STEPS]])                                                                                                |
| cargo-deny                                 | A workspace root holds a cargo-deny configuration file, which gives its workspace project a `deny` target ([[DES-WORKSPACE-TARGETS]])                     |
| cargo-audit                                | Never: no setting asks for `audit`, so a missing cargo-audit goes on the informational line. An `audit` task still fails without it ([[DES-DIAGNOSTICS]]) |

**`library` and `binary`.** Each creates one crate with `cargo new`, with `--lib` for `library` and `--bin` for `binary`. They have three options and no others:

| Option      | Required                      | Meaning                                                                                                                                                    |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory` | Yes; the first positional one | The crate's folder, resolved as Nx's own generators resolve it: against the folder `nx` runs in ([[EVD-NX-24-SETUP]])                                      |
| `name`      | No                            | The package name, passed as `--name`. Without it, cargo uses the folder's name.                                                                            |
| `edition`   | No                            | The edition, passed as `--edition`. Without it, cargo chooses: the edition that `[workspace.package]` sets, otherwise cargo's default ([[EVD-CARGO-NEW]]). |

- **Exclusion.** The generator first finds the workspace that will enclose the crate, as cargo does: the nearest manifest above the folder that has a `[workspace]` table. When that workspace's `exclude` matches the folder, the generator fails with a message that names the manifest and the entry, and runs no cargo. Cargo itself would add the folder to `members`, and an explicit member overrides `exclude` ([[EVD-CARGO-NEW]]).
- **Creation.** The generator writes nothing through Nx's file tree. The callback it returns runs `cargo new --vcs none` in place, with the options given. Cargo writes the crate, takes over what `[workspace.package]` and `[workspace.lints]` provide, and adds the folder to `members` of the enclosing workspace unless an entry already matches it, creating the list when there is none. The generator does not edit the workspace manifest itself. `--vcs none` is always passed, because cargo creates a git repository inside the new crate, even inside a git repository, when a folder on the way to it does not exist yet ([[EVD-CARGO-NEW]]).
- **Dry run.** With `--dry-run`, Nx does not run the callback ([[EVD-NX-24-SETUP]]). The generator prints the cargo command it would run and changes nothing.
- **Outside a workspace.** With no enclosing workspace, the crate is a [[TERM-STANDALONE-CRATE]], as with plain `cargo new`, and the generator says that it has its own `Cargo.lock` and build directory.
- **Failures.** When cargo fails, for example because the folder exists, the generator fails with cargo's message.

A generator that migrates a repository from `@monodon/rust` is not part of v1 ([[ADR-SETUP-GENERATORS]]).
:::

:::mara design DES-DIAGNOSTICS
:mid: 01M78FHG7F2T375STHFWNZZZYG
:title: Diagnostics
:status: accepted
:satisfies: REQ-DIAGNOSTICS
:satisfies: REQ-COMPATIBILITY

Every diagnostic names what is wrong, the crate, workspace, manifest, option or tool concerned, and what the user can do. Messages carry no error codes in v1 ([[ADR-NO-ERROR-CODES]]). Each row of the table is one problem; checks that later features add join it as rows.

| Problem                                                                                                                                                                                                       | Detected                                           | Severity                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Nx older than the supported majors ([[REQ-COMPATIBILITY]])                                                                                                                                                    | When the plugin loads; by `init`                   | Error                                                     |
| Nx newer than the supported majors ([[REQ-COMPATIBILITY]])                                                                                                                                                    | When the plugin loads; by `init`                   | Error; a warning with `NX_RUST_ALLOW_UNSUPPORTED_NX=true` |
| The installed Nx lacks, or has changed, the internal parts of Nx through which `init` runs the checks of graph creation ([[REQ-COMPATIBILITY]])                                                               | By `init`, before it writes                        | Error                                                     |
| `cargo` not found, or `cargo metadata` fails for a manifest ([[DES-DISCOVERY]])                                                                                                                               | When the graph is created                          | Error                                                     |
| Cargo older than 1.91 in a workspace                                                                                                                                                                          | When the graph is created                          | Error                                                     |
| A toolchain that a workspace pins is not installed                                                                                                                                                            | When the graph is created                          | Error                                                     |
| Two crates with one project name ([[REQ-PROJECT-NAMES]]); a collision with another plugin's project fails with Nx's own error instead ([[DES-PROJECT-GRAPH]])                                                 | When the graph is created                          | Error                                                     |
| `affectedTests` without the nextest runner ([[REQ-AFFECTED-TESTS]])                                                                                                                                           | When the graph is created                          | Error                                                     |
| An unknown key at the top level of a metadata table or of its `project` sub-table, or in the plugin options ([[DES-PLUGIN-OPTIONS]])                                                                          | When the graph is created                          | Error                                                     |
| A key under `options` or a configuration of a target table in Cargo metadata that the target's executor does not know ([[REQ-UNKNOWN-METADATA-OPTIONS]])                                                      | When the graph is created                          | Error                                                     |
| `inputs` without `"..."` on an inferred target in a metadata table ([[DES-PLUGIN-OPTIONS]])                                                                                                                   | When the graph is created                          | Error                                                     |
| A different `executor`, or a `command`, on an inferred target in a metadata table ([[DES-PLUGIN-OPTIONS]])                                                                                                    | When the graph is created                          | Error                                                     |
| `affectedTests = true` as an option of `test` in stored configuration, in a workspace without the `affectedTests` setting ([[DES-PLUGIN-OPTIONS]])                                                            | When the graph is created                          | Error                                                     |
| `targetNames` gives two inferred targets of one project the same name ([[DES-PLUGIN-OPTIONS]])                                                                                                                | When the graph is created                          | Error                                                     |
| A key of `targetNames` that is not the default name of an inferred target, or a value in it that is no target name ([[DES-PLUGIN-OPTIONS]])                                                                   | When the graph is created                          | Error                                                     |
| Entries of the plugin that receive manifests of one workspace give different values of `testRunner`, `affectedTests` or `featureUnification`, which the workspace table does not set ([[DES-PLUGIN-OPTIONS]]) | When the graph is created                          | Error                                                     |
| An `implicitDependencies` entry starting with `!` ([[DES-PLUGIN-OPTIONS]])                                                                                                                                    | When the graph is created                          | Error                                                     |
| A `fileInputs` pattern that resolves outside the repository or into Cargo's build or artifact directory ([[REQ-FILE-INPUTS-HASHABLE]])                                                                        | When the graph is created                          | Error                                                     |
| A path dependency without a project whose files Nx cannot see ([[DES-INPUTS]])                                                                                                                                | When the graph is created                          | Warning                                                   |
| An artifact directory outside the repository ([[DES-OUTPUTS]])                                                                                                                                                | When the graph is created                          | Warning                                                   |
| A build or artifact directory inside the repository that Nx does not ignore                                                                                                                                   | When the graph is created                          | Warning                                                   |
| Cargo fails in the `lockfile` task, such as on a stale or missing `Cargo.lock` in locked mode ([[DES-LOCKFILE-HASHING]])                                                                                      | When the `lockfile` task runs                      | Error                                                     |
| `Cargo.lock` changed during a cached task, so that the crate's digest no longer matches the task's key ([[DES-LOCKFILE-HASHING]])                                                                             | When the cargo call of the task has finished       | Error                                                     |
| A tool that a task runs is missing: cargo-nextest, cargo-affected, cargo-hakari, cargo-audit, cargo-deny, the `wasm-bindgen` CLI, the wasm target or the napi CLI                                             | When the task starts                               | Error                                                     |
| cargo-affected missing in a workspace with `affectedTests`, in a run in mode `full`                                                                                                                           | When a `test` task starts                          | Warning                                                   |
| A `build` task read a file in the repository that none of its inputs covers ([[REQ-BUILD-INPUT-CHECK]])                                                                                                       | When the cargo call of a `build` task has finished | Error                                                     |
| A value of `NX_RUST_TEST_MODE` other than `affected` and `full` ([[DES-TEST-MODE]])                                                                                                                           | When a `test` task starts                          | Error                                                     |
| `--affectedTests=true` on the command line for a `test` task in a workspace without the `affectedTests` setting ([[DES-PLUGIN-OPTIONS]])                                                                      | When a `test` task starts, before cargo runs       | Error                                                     |
| `wasm-bindgen` CLI and crate versions differ ([[DES-WASM]])                                                                                                                                                   | When the task starts                               | Error                                                     |
| An option that a task's executor does not know, from a target default, a `project.json` or `package.json`, or the command line ([[REQ-UNKNOWN-OPTIONS]])                                                      | When the task starts                               | Warning                                                   |

**Errors.** A problem found when the graph is created stops graph creation for the whole repository; the plugin never leaves a workspace or a crate out to get past it ([[REQ-DIAGNOSTICS]]). `init` runs the same checks and stops before it registers the plugin ([[DES-GENERATORS]]). An error found when a task starts, or when the cargo call of a `build` task has finished, fails that task, so that no success is cached for it. By default Nx stores no failure either; with `NX_CACHE_FAILURES=true` it stores the failure and replays it until an input of the task changes ([[EVD-NX-24-FILE-INPUTS]]).

**Warnings where they are seen.** While the Nx daemon creates the graph, what the plugin prints goes to the daemon's log file and not to the terminal, and Nx's plugin interface has no channel for warnings ([[EVD-NX-24-SETUP]]). The plugin therefore prints a warning found when the graph is created three times: when the graph is created, again from the executor at the start of each task of the crate or workspace it concerns, and from `init`.

**Nx version.** When it loads, the plugin compares the major version of the installed `nx` with the majors in its peer dependency range, so an unsupported Nx fails graph creation also in a repository without a crate. The error names the major found and the supported majors. For a newer major, `NX_RUST_ALLOW_UNSUPPORTED_NX=true` turns the error into a warning that says the plugin has not been checked on that major, and the plugin continues ([[REQ-COMPATIBILITY]]). The variable has no effect on an older major. The installed `nx` is the one that resolves from the repository root, where Nx itself looks for it. The daemon takes over each client's environment and recomputes the graph when a variable changes, but it can keep a loaded plugin, so the plugin compares again each time it creates the graph and prints the warning there; the variable thus works with the daemon as well ([[EVD-NX-24-SETUP]], [[EVD-NX-24-VERSION-CHECK]]). The peer dependency range itself stops no install, because pnpm only warns about an unmet peer.

**Cargo version.** The `cargo metadata` report of a stable Cargo has a `build_directory` field from 1.91 on ([[EVD-CARGO-DIRECTORIES]]). A report without it therefore tells the check that the workspace's Cargo is too old, and while Cargo is supported the check adds no cargo call to the one that the workspace costs ([[REQ-MULTI-WORKSPACE]]). Only the error makes a second call, to name the version found.

**Toolchains.** Graph creation and the toolchain input of a task's cache key do not let rustup install a toolchain that a workspace pins and that is missing. Graph creation fails with a message that names the toolchain and the workspace. The toolchain input cannot fail a task, so it gives the task a key that matches no stored result, and the task keeps plain cargo's behaviour ([[ADR-GRAPH-NO-TOOLCHAIN-INSTALL]], [[DES-INPUTS]]).

**Directories that Nx does not ignore.** Nx leaves out only what `.gitignore` and `.nxignore` exclude and a few fixed folders, `target` not among them, and `cargo new --vcs none` writes no `.gitignore` ([[EVD-NX-24-SETUP]], [[EVD-CARGO-NEW]]). By default Cargo puts both its directories in the workspace folder, which for a standalone crate is the crate's folder, all of whose files are inputs ([[EVD-CARGO-DIRECTORIES]], [[REQ-INPUT-FILES]]). When Cargo's build or artifact directory lies inside the repository and Nx does not ignore it, the warning names the directory and advises adding it to `.gitignore`.

**Missing tools.** The message names the tool, the target or setting that needs it, and how to get it. The plugin installs nothing ([[ADR-V1-SCOPE]]).
:::

## Scenario

:::mara scenario SCN-ADOPT
:mid: 01M78FHG7FBRMYNWBR4T2Z3PHJ
:title: A team adds the plugin to an existing mixed repository
:status: accepted

A team has an Nx monorepo with JS apps and a Cargo workspace under `rust/` that Nx does not know about; CI runs the Rust checks through a separate script. A developer runs `nx add @convesoft/nx-rust`. The plugin is registered in `nx.json`, and the command reports that nextest is not installed, which the workspace's settings do not need. No file under `rust/` changes. `nx show projects` now lists every crate, and `nx graph` shows the edges between crates. The team replaces the script with the `nx affected -t lint test build` step that CI already runs for JS. Developers who work only on Rust keep using `cargo` and rust-analyzer as before, and their builds and the Nx builds reuse each other's compiled dependencies.
:::
