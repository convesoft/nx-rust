# Setup and compatibility

> **Status:** milestone 0.1 is implemented on `main` but not published to npm
> yet, so `nx add @convesoft/nx-rust` cannot install it before the release. Of
> the tools below, tasks run only cargo-audit and cargo-deny so far. The
> features that need the others arrive with milestones 0.2 to 0.4, and until
> then `init` reports those tools as not needed by your settings.

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
plugin in `nx.json`, adds three empty entries to its `targetDefaults`, and changes
nothing else in your repository: no crate, no Cargo manifest, no
`.cargo/config.toml`.

Rust targets share names such as `build`, `lint` and `test` with JS targets, so
a target default keyed by one of those names would reach them too. `init`
therefore adds an empty entry keyed by each executor of the Rust targets, where
`targetDefaults` has none:

```json
{
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "cache": true },
    "@convesoft/nx-rust:cargo": {},
    "@convesoft/nx-rust:run": {},
    "@convesoft/nx-rust:lockfile": {}
  }
}
```

Nx chooses an entry keyed by a target's executor before one keyed by its name,
so `build` keeps applying to your JS projects and leaves the Rust targets as the
plugin infers them
([Targets](targets.mara.md#target-defaults-that-reach-rust-targets)). `init`
says which entries it added. It never changes or removes an entry that is there,
also not one keyed by these executors.

Before it writes anything, `init` checks the repository the way Nx will once
the plugin and those entries are in place. If Nx could not build the project
graph, for example because cargo is not installed or two crates have the same
name, `init` stops with that error and `nx.json` stays as it was. The package
stays installed. Fix the problem and run `nx add @convesoft/nx-rust` again.

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
`nx.json`, options included, and your `targetDefaults` as they are, adds an
empty entry only where one is missing, and prints the report again.

Afterwards:

```sh
nx show projects          # your crates are listed
nx graph                  # with their dependencies
nx run-many -t lint test  # Rust and JS together
```

To add the plugin by hand, put it into `nx.json`, with the entries that `init`
adds:

```json
{
  "plugins": ["@convesoft/nx-rust"],
  "targetDefaults": {
    "@convesoft/nx-rust:cargo": {},
    "@convesoft/nx-rust:run": {},
    "@convesoft/nx-rust:lockfile": {}
  }
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
  again at the start of each task of the crate concerned, or of the target
  concerned for a warning about one target, such as one about `targetDefaults`,
  and `nx add` prints it too. `NX_DAEMON=false` shows it directly.
- A crate's warnings are part of its tasks' cache keys. When a warning appears
  or goes away, the crate's tasks, and those of the crates that depend on it,
  run again, so a task that Nx restores from the cache shows the warnings that
  apply now. With the daemon, a warning about a file outside the repository,
  such as your Cargo home's `config.toml`, appears and goes away only once a
  file in the repository changes or you run `nx reset`, as the warning says.
- The terminal UI's summary of several tasks, and Nx in CI by default, leave
  out the output of tasks that succeeded, and with it these warnings. Run with
  `--output-style=static` to see them.

Keep Cargo's folders out of what Nx sees. Apart from a few fixed folders such
as `node_modules`, Nx ignores only what `.gitignore` and `.nxignore` say, so a
`target` folder that neither covers is hashed with your sources, and the plugin
warns about it. On your machine Nx also follows `.git/info/exclude` and your
global git excludes file, but other clones and CI do not have them, so the
plugin warns all the same. Either file of the repository will do:

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

**`init`**, which `nx add` runs after Nx has installed the package. In v1 it takes no options of its own: it registers the plugin, keeps target defaults keyed by target names away from the plugin's targets, and reports. Options can be added later without breaking anything. Its only changes are in `nx.json`: the plugin entry and empty `targetDefaults` entries. It works in three steps.

1. **Check.** It runs the checks that graph creation runs on `nx.json` as step 2 will leave it ([[DES-DIAGNOSTICS]]): the Nx version and, for the `Cargo.toml` files that Nx would hand the plugin, cargo, the Cargo version and toolchain of each workspace, each workspace's `cargo metadata` report, the project names, and what the `targetDefaults` of `nx.json` do to the inferred targets ([[DES-TARGET-DEFAULT-GUARD]]). A problem that would stop graph creation stops `init` before it writes anything, with the message graph creation would give. A registered plugin whose graph fails stops every Nx command that requires the project graph, the tasks of JS projects and `nx g` included ([[EVD-NX-24-SETUP]]). In a repository without any `Cargo.toml`, only the Nx version is checked and no cargo runs.
2. **Register.** It adds the plugin to `plugins` in `nx.json`. When `nx.json` lists the plugin already, that entry, with whatever options the user set, stays exactly as it is, and `init` still runs its checks, adds the entries below and prints its report.

   For each executor of the plugin's targets ([[DES-TARGETS]]) that `targetDefaults` has no entry for, it adds an empty entry keyed by that executor. Nx chooses an entry keyed by a target's executor before one keyed by the target's name or a glob, even when it is empty ([[EVD-NX-TARGET-DEFAULTS]]), so entries keyed by names that Rust targets share with JS targets, such as `build`, keep applying to JS targets and do not reach the plugin's. An entry that is there, keyed by one of these executors or by anything else, stays exactly as it is, whatever it sets, and [[DES-TARGET-DEFAULT-GUARD]] judges it in step 1: `init` never changes or removes an entry of `targetDefaults`. Where `nx.json` extends another file and only that file has `targetDefaults`, the combined entries go into `nx.json`, which Nx then reads instead.

3. **Report.** It prints, without writing anything:
   - the `targetDefaults` entries it added, naming their executors and saying that entries keyed by a target's name or a glob reach the other projects and not the plugin's targets;
   - the warnings that graph creation gives ([[DES-DIAGNOSTICS]]), among them an entry keyed by one of the plugin's executors that adds dependencies to inferred targets, with the ways to narrow it. The user applies the fix by hand;
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

| Problem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Detected                                           | Severity                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Nx older than the supported majors ([[REQ-COMPATIBILITY]])                                                                                                                                                                                                                                                                                                                                                                                                                               | When the plugin loads; by `init`                   | Error                                                     |
| Nx newer than the supported majors ([[REQ-COMPATIBILITY]])                                                                                                                                                                                                                                                                                                                                                                                                                               | When the plugin loads; by `init`                   | Error; a warning with `NX_RUST_ALLOW_UNSUPPORTED_NX=true` |
| The installed Nx lacks, or has changed, the internal parts of Nx through which `init` runs the checks of graph creation ([[REQ-COMPATIBILITY]])                                                                                                                                                                                                                                                                                                                                          | By `init`, before it writes                        | Error                                                     |
| The installed Nx lacks one of the internal parts of Nx that [[DES-TARGET-DEFAULT-GUARD]] runs, where a target of the plugin differs from what the plugin inferred                                                                                                                                                                                                                                                                                                                        | When the graph is created; by `init`               | Error                                                     |
| `cargo` not found, `cargo metadata` fails for a manifest ([[DES-DISCOVERY]]), or a root manifest or configuration file that cargo reads is no valid TOML ([[DES-METADATA-REPORT]])                                                                                                                                                                                                                                                                                                       | When the graph is created                          | Error                                                     |
| Cargo older than 1.91 in a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                     | When the graph is created                          | Error                                                     |
| A toolchain that a workspace pins is not installed                                                                                                                                                                                                                                                                                                                                                                                                                                       | When the graph is created                          | Error                                                     |
| Two projects of the plugin, crates or workspace projects, with one name ([[REQ-PROJECT-NAMES]]); the plugin's error after Nx's is promised under names it gave them, else best effort ([[DES-PROJECT-GRAPH]])                                                                                                                                                                                                                                                                            | When the graph is created                          | Error                                                     |
| A `[workspace.metadata.nx.project]` table in a root manifest that defines a crate; the message points to `[package.metadata.nx]` ([[DES-PROJECT-GRAPH]], [[DES-METADATA-TABLES]])                                                                                                                                                                                                                                                                                                        | When the graph is created                          | Error                                                     |
| `affectedTests` without the nextest runner ([[REQ-AFFECTED-TESTS]])                                                                                                                                                                                                                                                                                                                                                                                                                      | When the graph is created                          | Error                                                     |
| An unknown key at the top level of a metadata table or of its `project` sub-table, or in the plugin options ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                     | When the graph is created                          | Error                                                     |
| A key under `options` or a configuration of a target table in Cargo metadata that the target's executor does not know or the target does not take, or `pluginVersion` ([[REQ-UNKNOWN-METADATA-OPTIONS]])                                                                                                                                                                                                                                                                                 | When the graph is created                          | Error                                                     |
| `inputs` without `"..."` on an inferred target in a metadata table ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                                                              | When the graph is created                          | Error                                                     |
| A different `executor`, or a `command`, on an inferred target in a metadata table ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                                               | When the graph is created                          | Error                                                     |
| A field of a target table in a metadata table whose type is not the one that Nx gives it, such as `options = "broken"` ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                          | When the graph is created                          | Error                                                     |
| `affectedTests = true` as an option of `test` in stored configuration, in a workspace without the `affectedTests` setting ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                       | When the graph is created                          | Error                                                     |
| `targetNames` gives two inferred targets of one project the same name ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                                                           | When the graph is created                          | Error                                                     |
| A key of `targetNames` that is not the default name of an inferred target, or a value in it that is no target name ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                              | When the graph is created                          | Error                                                     |
| `locked` in the plugin options is neither `true` nor `false` ([[DES-INVOCATION]])                                                                                                                                                                                                                                                                                                                                                                                                        | When the graph is created                          | Error                                                     |
| Entries of the plugin that receive manifests of one workspace give different values of `testRunner`, `affectedTests` or `featureUnification`, which the workspace table does not set ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                            | When the graph is created                          | Error                                                     |
| An `implicitDependencies` entry starting with `!` ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                                                                               | When the graph is created                          | Error                                                     |
| A `fileInputs` pattern that resolves outside the repository or into Cargo's build or artifact directory, or has a `..` segment after a glob character ([[REQ-FILE-INPUTS-HASHABLE]], [[DES-INPUTS]])                                                                                                                                                                                                                                                                                     | When the graph is created                          | Error                                                     |
| A `fileInputs` pattern that names files in the folder of another plugin's project below where it starts, inside another project's folder; the message gives the pattern to add ([[REQ-FILE-INPUTS-HASHABLE]], [[DES-INPUTS]])                                                                                                                                                                                                                                                            | When the graph is created                          | Error                                                     |
| A `targetDefaults` entry that turns on caching that the plugin leaves off, or replaces the `inputs`, `outputs` or `dependsOn` it declares, on a target of the plugin ([[DES-TARGET-DEFAULT-GUARD]])                                                                                                                                                                                                                                                                                      | When the graph is created                          | Error                                                     |
| A `pluginVersion` on an inferred target that the plugin did not give it, from `targetDefaults`, a `project.json`, a `package.json` or another plugin; the message names the entry or file where the plugin can tell ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                             | When the graph is created                          | Error                                                     |
| A `[patch]`, `[replace]` or `paths` entry from a file that Nx does not watch: a configuration file outside the repository, or a configuration file or root manifest inside it that an ignore rule, such as one in `.gitignore` or `.nxignore`, leaves out of the files that Nx reads; the message says to move the entries into the repository, or to stop ignoring the file or run `nx reset` after changing it; once per plugin entry ([[ADR-REDIRECTION-EDGES]])                      | When the graph is created                          | Warning                                                   |
| A file that `include` names that is no valid TOML, or a crate without a project that `[patch]` or `[replace]` redirects to and `cargo metadata` fails for ([[DES-METADATA-REPORT]])                                                                                                                                                                                                                                                                                                      | When the graph is created                          | Warning                                                   |
| A path dependency without a project that `cargo metadata` does not report for a reason that cargo checks only for the crate it reports: it is no member of the workspace whose folder holds it, or the manifest that its `package.workspace` names has no `[workspace]` table or cannot be read ([[DES-METADATA-REPORT]])                                                                                                                                                                | When the graph is created                          | Warning                                                   |
| A path dependency without a project whose files Nx cannot see ([[DES-INPUTS]])                                                                                                                                                                                                                                                                                                                                                                                                           | When the graph is created                          | Warning                                                   |
| A `targetDefaults` entry that adds a dependency on tasks of other projects, such as `^build`, to a target of the plugin ([[DES-TARGET-DEFAULT-GUARD]])                                                                                                                                                                                                                                                                                                                                   | When the graph is created                          | Warning                                                   |
| A target of the plugin that differs from what the plugin inferred, where the plugin cannot tell which configuration changed it, such as another plugin ([[DES-TARGET-DEFAULT-GUARD]])                                                                                                                                                                                                                                                                                                    | When the graph is created                          | Warning                                                   |
| An artifact directory outside the repository ([[DES-OUTPUTS]])                                                                                                                                                                                                                                                                                                                                                                                                                           | When the graph is created                          | Warning                                                   |
| An artifact directory that two or more workspaces share ([[DES-OUTPUTS]])                                                                                                                                                                                                                                                                                                                                                                                                                | When the graph is created                          | Warning                                                   |
| A build or artifact directory inside the repository that Nx does not ignore                                                                                                                                                                                                                                                                                                                                                                                                              | When the graph is created                          | Warning                                                   |
| Nx hands a workspace's root manifest to no entry of the plugin, so that the workspace has no lockfile task and its crates' `build`, `check`, `lint` and `test` run uncached; the message names the root manifest ([[DES-LOCKFILE-HASHING]])                                                                                                                                                                                                                                              | When the graph is created                          | Warning                                                   |
| Cargo fails in the `lockfile` task, such as on a stale or missing `Cargo.lock` in locked mode ([[DES-LOCKFILE-HASHING]])                                                                                                                                                                                                                                                                                                                                                                 | When the `lockfile` task runs                      | Error                                                     |
| `Cargo.lock` or a digest of it changed during a cached task, also through another `nx` command, so that the crate's digest no longer matches the one its command's lockfile task wrote or the task's key ([[DES-LOCKFILE-HASHING]])                                                                                                                                                                                                                                                      | When the cargo call of the task has finished       | Error                                                     |
| A task of a cached target that the plugin makes depend on the lockfile task runs without it in a run that does not exclude task dependencies, so that its key holds no digest, as where a `project.json` replaces its `dependsOn` ([[DES-LOCKFILE-HASHING]])                                                                                                                                                                                                                             | When the task starts, before cargo runs            | Error                                                     |
| A tool that a task runs is missing: cargo-nextest, cargo-affected, cargo-hakari, cargo-audit, cargo-deny, the `wasm-bindgen` CLI, the wasm target or the napi CLI                                                                                                                                                                                                                                                                                                                        | When the task starts                               | Error                                                     |
| cargo-affected missing in a workspace with `affectedTests`, in a run in mode `full`                                                                                                                                                                                                                                                                                                                                                                                                      | When a `test` task starts                          | Warning                                                   |
| A `build` task read a file in the repository that none of its inputs covers ([[REQ-BUILD-INPUT-CHECK]])                                                                                                                                                                                                                                                                                                                                                                                  | When the cargo call of a `build` task has finished | Error                                                     |
| The installed Nx lacks `HashPlanInspector` or the glob of the workspace context, through which the check of [[DES-BUILD-INPUT-CHECK]] matches a build's files with its inputs; the check does not run, and Nx caches the result                                                                                                                                                                                                                                                          | When the cargo call of a `build` task has finished | Warning                                                   |
| A value of `NX_RUST_TEST_MODE` other than `affected` and `full` ([[DES-TEST-MODE]])                                                                                                                                                                                                                                                                                                                                                                                                      | When a `test` task starts                          | Error                                                     |
| A value of `NX_RUST_LOCKED` other than `true` and `false`; an empty value counts as unset ([[DES-INVOCATION]])                                                                                                                                                                                                                                                                                                                                                                           | When a task starts, before cargo runs              | Error                                                     |
| A `pluginVersion` for one run that differs from the target's, such as `--pluginVersion` on the command line ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                     | When a task starts, before cargo runs              | Error                                                     |
| A target that names a plugin executor but was not inferred; the message says to use a target with a `command` instead ([[DES-TARGETS]])                                                                                                                                                                                                                                                                                                                                                  | When the task starts, before cargo runs            | Error                                                     |
| Cargo's configuration of a workspace, or the `CARGO_BUILD_TARGET` of graph creation, picks a triple whose folder the plugin cannot name, such as `host-tuple`, so that `build` and `doc` stay uncached unless their own options name a triple that no configuration clears; the message names the value, what picks it and the `targetTriple` option ([[DES-OUTPUTS]])                                                                                                                   | When the graph is created                          | Warning                                                   |
| When a cached `build` or `doc` whose run names no triple starts, the task's environment and Cargo's configuration pick other triples than its outputs name, as a `CARGO_BUILD_TARGET` in a dotenv file of the task does, or a triple whose folder the plugin cannot name; the message names the triples, what picks them and the `targetTriple` option ([[DES-OUTPUTS]])                                                                                                                 | When the task starts, before cargo runs            | Error                                                     |
| When a cached `build` or `doc` starts, Cargo's configuration alone picks other triples than when Nx created the graph, where the run names no triple, or gives another artifact directory, as after a change to a configuration file outside the repository that the Nx daemon does not watch; the message says what changed and to run `nx reset`, or stop the daemon, and run the task again ([[DES-OUTPUTS]])                                                                         | When the task starts, before cargo runs            | Error                                                     |
| When a cached `build` or `doc` starts, cargo reports, with the task's environment, another artifact directory than its outputs name, as where a dotenv file that Nx loads only for the task sets `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` or `CARGO_HOME`; the message names both folders and the variables, and says to set them in the environment of the `nx` command or in the root `.env`, or to set the folder as `build.target-dir` in `.cargo/config.toml` ([[DES-OUTPUTS]]) | When the task starts, before cargo runs            | Error                                                     |
| `cargo metadata` fails when a cached `build` or `doc`, or any `build`, starts, so that the plugin cannot tell Cargo's directories for the task; the message carries cargo's and says to correct what cargo reports ([[DES-OUTPUTS]], [[DES-BUILD-INPUT-CHECK]])                                                                                                                                                                                                                          | When the task starts, before cargo runs            | Error                                                     |
| The `targetTriple` option of a cached `build` or `doc` is `host-tuple` or a target specification file; the message names the option and its value, says that the plugin cannot name the folder that cargo writes to for it, and says to pass the host's triple, which it names, in place of `host-tuple`, or for a specification file to build with a built-in triple or with caching turned off for the target ([[DES-OUTPUTS]])                                                        | When the task starts, before cargo runs            | Error                                                     |
| The profile `dev`, `test` or `bench` on `build` or `doc`; the message names the profile to use instead ([[DES-OUTPUTS]])                                                                                                                                                                                                                                                                                                                                                                 | When the task starts, before cargo runs            | Error                                                     |
| The configuration caches a target that the plugin leaves uncached in its project, such as through a `project.json`; the message gives the reason and how to find the setting ([[DES-OUTPUTS]])                                                                                                                                                                                                                                                                                           | When the task starts, before cargo runs            | Error                                                     |
| `--affectedTests=true` on the command line for a `test` task in a workspace without the `affectedTests` setting ([[DES-PLUGIN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                                 | When a `test` task starts, before cargo runs       | Error                                                     |
| `wasm-bindgen` CLI and crate versions differ ([[DES-WASM]])                                                                                                                                                                                                                                                                                                                                                                                                                              | When the task starts                               | Error                                                     |
| An option that a task's executor does not know, from a target default, a `project.json` or `package.json`, or the command line ([[REQ-UNKNOWN-OPTIONS]])                                                                                                                                                                                                                                                                                                                                 | When the task starts                               | Warning                                                   |

**Errors.** A problem found when the graph is created stops graph creation for the whole repository; the plugin never leaves a workspace or a crate out to get past it ([[REQ-DIAGNOSTICS]]). `init` runs the same checks and stops before it registers the plugin ([[DES-GENERATORS]]). An error found when a task starts, or when the cargo call of a `build` task has finished, fails that task, so that no success is cached for it. By default Nx stores no failure either; with `NX_CACHE_FAILURES=true` it stores the failure and replays it until an input of the task changes ([[EVD-NX-24-FILE-INPUTS]]).

**Warnings where they are seen.** Nx 24 gives a plugin no channel to the terminal of a command that uses the Nx daemon's graph. What graph creation prints goes to the daemon's log file ([[EVD-NX-24-SETUP]]). A line that a plugin worker sends to the daemon's clients reaches only a command that is waiting for that computation, and the daemon also creates the graph again in the background after a change. The `preTasksExecution` and `postTasksExecution` hooks run in the daemon as well ([[EVD-NX-24-WARNING-CHANNELS]]). Only a task's own output reaches the terminal there, and Nx stores it and replays it on a cache hit. The plugin therefore prints a warning found when the graph is created three times: when the graph is created, again from the executor at the start of each task of the crate, workspace or target it concerns, and from `init`. Graph creation records the warnings that concern a project in the project's metadata, under `cargo.warnings`, where the executor finds them; the warning for an Nx major newer than the supported ones, which `NX_RUST_ALLOW_UNSUPPORTED_NX` lets the plugin run with, concerns every project. Graph creation also gives a project with warnings a named input, `nx-rust-warnings`, which no target names and which holds a digest of them. A project without warnings gets none, so that its keys hold nothing of this. Nx hashes a project's named inputs into the key of each of its tasks and of the tasks that depend on it ([[EVD-NX-24-WARNING-CHANNELS]], [[DES-INPUTS]]). So when a project's warnings change, its cached tasks run again and print the new ones, and a cache hit replays the warnings of the graph that the command uses. With the daemon, that graph keeps a warning about configuration outside the repository until a file in the repository changes or the daemon restarts, as the warning says. Where Nx shows no output of a task that succeeded, as in the terminal UI's summary of several tasks and by default in CI, only the copy from graph creation is seen, and only without the daemon.

The digest is SHA-256 over the project's warnings, each once and in a fixed order, with every path inside the repository written relative to the repository root, so that checkouts of one repository in different folders get the same keys. A path outside the repository stays as the warning names it, because it identifies the cause, such as the Cargo home whose `config.toml` redirects dependencies. Machines whose warnings name different such paths, such as Cargo homes in different users' home folders, therefore compute different keys for the tasks of the projects concerned and share no cache entries for them through a shared or remote cache, until the cause is gone or moved into the repository.

What else the executor prints before cargo runs follows from the key, or the task fails:

| Line                                                                                                                                                                                                                                                                            | Why a cache hit shows it as the task would print it                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An option that the task ignores ([[DES-UNKNOWN-OPTIONS]])                                                                                                                                                                                                                       | The options come from the target's options and configurations, which the project's configuration in every key holds, and from the command line, which Nx hashes as the task's overrides ([[EVD-NX-OPTION-VALIDATION]]) |
| The check of [[DES-BUILD-INPUT-CHECK]] did not run, because the installed Nx lacks a part                                                                                                                                                                                       | Only an Nx that the plugin does not support lacks one, and it runs only with `NX_RUST_ALLOW_UNSUPPORTED_NX`, whose warning names the version found and is in every project's digest                                    |
| An error of a row of the table above detected when the task starts or when its cargo call has finished, such as a missing tool, an artifact directory or triples other than the outputs name, `cargo metadata` failing, or a `targetTriple` whose folder the plugin cannot name | The task fails and Nx stores no result, unless `NX_CACHE_FAILURES=true` (**Errors**)                                                                                                                                   |

Two cases stay outside the key, because what they depend on is deliberately no input: whether a tool is on `PATH` decides the warning for cargo-affected missing in mode `full`, and, with `NX_CACHE_FAILURES=true`, the stored failure of a task whose tool was missing. A hit replays what the run that stored the result printed.

**Warnings that `createDependencies` finds.** Those of [[DES-TARGET-DEFAULT-GUARD]] depend on the projects as Nx merged them, which only `createDependencies` receives, and that hook can change neither a project's metadata nor its named inputs. `createMetadata`, which Nx calls after it in the same process with the merged graph, gives each project whose targets they concern those warnings in its metadata, under `cargo.targetWarnings`, each with its target and with the text that graph creation prints; Nx merges that metadata into the project's and keeps it out of keys ([[EVD-NX-24-WARNING-CHANNELS]]). The executor prints each, once, at the start of a task of its target, after the project's warnings. The key follows their causes as far as Nx and `createNodes` can see them:

- An entry of `targetDefaults` in `nx.json` changes every key, because Nx hashes `nx.json` into each ([[EVD-NX-OPTION-VALIDATION]]). An entry from a file that `nx.json` extends, which Nx does not hash, reaches the key through the digest: it also covers the `dependsOn` entries that `targetDefaults` adds to the project's targets, as far as `createNodes` sees them, with the projects of its own entry, Nx's synthesis of target defaults and the `package.json` and `project.json` in the projects' folders ([[DES-TARGET-DEFAULT-GUARD]]). An entry whose `filter` selects projects by a tag, also through `!`, counts for every project of the plugin with a target that the entry's key can reach, because another plugin may give the tag and `createNodes` cannot tell; a filter by a project's name, folder, plugin or executor keeps its exact reading. An entry that its form shows to add only tasks of the project itself, such as `"check"` or `{ "target": "check" }`, stays out of the digest. A project with an entry that counts gets the named input even without warnings.
- A target that changed where the plugin cannot tell why: a changed `inputs`, `outputs` or tag is part of the project's configuration that every key holds, and `cache` turned on where the plugin leaves it off fails the task when it starts, so that nothing is stored.

Three limits remain. Where only the list of projects that a warning names changes, as when a crate is added elsewhere, a cache hit of another crate shows the earlier list until its key changes. An entry from an extended file that does not apply to a project, or adds only the project's own tasks, where `createNodes` cannot tell, changes the digest and causes one run without a warning: one filtered to a tag that the project does not have, or one with a `projects` pattern like `api*` that matches only `api`; in `nx.json`, any change to an entry runs every task again anyway. And a `dependsOn` that another plugin changes, from files that no key holds, changes no key: a hit can show the warning about that target from before the change, or miss it.

**Nx version.** When it loads, the plugin compares the major version of the installed `nx` with the majors in its peer dependency range, so an unsupported Nx fails graph creation also in a repository without a crate. The error names the major found and the supported majors. For a newer major, `NX_RUST_ALLOW_UNSUPPORTED_NX=true` turns the error into a warning that says the plugin has not been checked on that major, and the plugin continues ([[REQ-COMPATIBILITY]]). The variable has no effect on an older major. The installed `nx` is the one that resolves from the repository root, where Nx itself looks for it. The daemon takes over each client's environment and recomputes the graph when a variable changes, but it can keep a loaded plugin, so the plugin compares again each time it creates the graph and prints the warning there; the variable thus works with the daemon as well ([[EVD-NX-24-SETUP]], [[EVD-NX-24-VERSION-CHECK]]). The peer dependency range itself stops no install, because pnpm only warns about an unmet peer.

**Cargo version.** The `cargo metadata` report of a stable Cargo has a `build_directory` field from 1.91 on ([[EVD-CARGO-DIRECTORIES]]). A report without it therefore tells the check that the workspace's Cargo is too old, and while Cargo is supported the check adds no cargo call to the one that the workspace costs ([[REQ-MULTI-WORKSPACE]]). Only the error makes a second call, to name the version found.

**Toolchains.** Graph creation and the toolchain input of a task's cache key do not let rustup install a toolchain that a workspace pins and that is missing. Graph creation fails with a message that names the toolchain and the workspace. The toolchain input cannot fail a task, so it gives the task a key that matches no stored result, and the task keeps plain cargo's behaviour ([[ADR-GRAPH-NO-TOOLCHAIN-INSTALL]], [[DES-INPUTS]]).

**Directories that Nx does not ignore.** Of the files of a repository, Nx leaves out only what `.gitignore` and `.nxignore` exclude and a few fixed folders, `target` not among them, and `cargo new --vcs none` writes no `.gitignore` ([[EVD-NX-24-SETUP]], [[EVD-CARGO-NEW]]). By default Cargo puts both its directories in the workspace folder, which for a standalone crate is the crate's folder, all of whose files are inputs ([[EVD-CARGO-DIRECTORIES]], [[REQ-INPUT-FILES]]). When Cargo's build or artifact directory lies inside the repository and Nx does not ignore it, the warning names the directory and advises adding it to `.gitignore`. The directory is the folder that cargo writes to, which the system reaches through the path that the `cargo metadata` report gives, as for the outputs ([[DES-OUTPUTS]]): that folder, relative to the repository's real path, decides whether the directory lies inside the repository and whether Nx ignores it, and the warning names it and the line for `.gitignore` by it. So a directory that a symbolic link leads outside the repository draws no warning, and one that a link leads to another folder inside the repository is judged and named by that folder. Where links make that folder differ from the one that the reported path names as text, the warning adds the path exactly as cargo reports it in brackets, so that the setting behind it can be found. That path is not normalised: a `..` after a link leaves the folder that the link leads to, so taking it as text could name a folder that does not exist. `init` names a build directory inside the repository in the same way. The plugin applies these rules as Nx itself reads them from the ignore files on disk, so it warns also before Cargo has created the directory, and where the installed Nx lacks that reading it does not warn. On the machine where it runs, Nx also leaves out what `.git/info/exclude` and the user's global git excludes file exclude ([[EVD-NX-24-SETUP]]), but the warning stays where only one of these covers the directory: neither file is part of the repository, so other clones and CI do not leave the directory out, and the warning names a gap that the repository has. A directory that several workspaces use gets one warning, which names them all, and the tasks of each of them print it.

**Missing tools.** The message names the tool, the target or setting that needs it, and how to get it. The plugin installs nothing ([[ADR-V1-SCOPE]]).
:::

## Scenario

:::mara scenario SCN-ADOPT
:mid: 01M78FHG7FBRMYNWBR4T2Z3PHJ
:title: A team adds the plugin to an existing mixed repository
:status: accepted

A team has an Nx monorepo with JS apps and a Cargo workspace under `rust/` that Nx does not know about; CI runs the Rust checks through a separate script. A developer runs `nx add @convesoft/nx-rust`. The plugin is registered in `nx.json`, and the command reports that nextest is not installed, which the workspace's settings do not need. No file under `rust/` changes. `nx show projects` now lists every crate, and `nx graph` shows the edges between crates. The team replaces the script with the `nx affected -t lint test build` step that CI already runs for JS. Developers who work only on Rust keep using `cargo` and rust-analyzer as before, and their builds and the Nx builds reuse each other's compiled dependencies.
:::
