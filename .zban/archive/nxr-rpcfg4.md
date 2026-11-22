---
title: Hash CLIPPY_CONF_DIR file content and warn on per-user rustfmt config
status: done
type: bug
priority: high
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T12:03:50Z
---

Cites: `DES-INPUTS`, `DES-DIAGNOSTICS`, `RISK-HOST-ENVIRONMENT`, `GOAL-TRUSTED-CACHE`, `VER-CACHE-KEYS`.

Two cache-configuration findings from adopting `1.0.0-rc.1` in `mara`:

1. `lint` declares `{ env: "CLIPPY_CONF_DIR" }` in `nx-rust/src/graph/inputs.ts`, which hashes only the directory path string and misses edits to `clippy.toml` or `.clippy.toml` inside that directory (reproduced on `rc.1`: changing `too-many-arguments-threshold` restored a cached pass).
2. Maintainer decision (22 Nov 2026): keep external Cargo config (`$CARGO_HOME/config.toml`, etc.) and per-user Rustfmt config (`$XDG_CONFIG_HOME/rustfmt/rustfmt.toml`, `~/.config/rustfmt/rustfmt.toml`, `~/.rustfmt.toml`) accepted under `RISK-HOST-ENVIRONMENT` rather than hashing them into cache keys, and emit the same clear graph-creation warning for per-user Rustfmt configuration outside the repository that the plugin already emits for external Cargo configuration.

- [x] Check real `cargo clippy` precedence between `clippy.toml` and `.clippy.toml` in `CLIPPY_CONF_DIR` and real `rustfmt` precedence for per-user config files outside the repository
- [x] Update `DES-INPUTS`, `DES-DIAGNOSTICS` and `RISK-HOST-ENVIRONMENT` (with evidence as needed)
- [x] Hash the selected Clippy configuration file's content in `lint`'s key when `CLIPPY_CONF_DIR` is set (handling missing/unreadable paths safely and keeping keys unchanged when `CLIPPY_CONF_DIR` is unset)
- [x] Emit a clear graph-creation warning when a per-user `rustfmt.toml` outside the repository applies, matching the external Cargo config warning style
- [x] Add tests using the real Nx hasher and real `cargo clippy` / `rustfmt` covering `CLIPPY_CONF_DIR` content invalidation and per-user rustfmt warning behaviour

Done when: editing the Clippy config file selected by `CLIPPY_CONF_DIR` invalidates `lint`'s cache key, per-user rustfmt config emits a clear graph-creation warning, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.

## Summary of Changes

- `lint` has a new POSIX shell runtime input (`clippyConfigurationCommand` in `nx-rust/src/graph/clippy-input.ts`). It looks in every folder that clippy can be given as `CLIPPY_CONF_DIR`:
  - the variable in the task's environment;
  - each value that `CLIPPY_CONF_DIR` under `[env]` has in the Cargo configuration files that cargo reads in the workspace root, the included ones among them. Graph creation reads these with the existing configuration walk, which `tableSettings` in `cargo/build-settings.ts` now gives for any table (`configuredClippyFolders`). The value goes into the command as cargo passes it: as written, or with `relative = true` resolved against the folder that holds the file's `.cargo` folder.
- For each such folder, after a line naming its source, the command goes to the workspace root and from there to the folder. It looks in that folder and the folders above it, as clippy does. In the first folder that holds `.clippy.toml` or `clippy.toml`, it prints each of the two files with its name, size and content. It does not repeat cargo's precedence between the sources. When nothing is set anywhere, it prints nothing. A relative value gets `./`, so that a folder named `-` is not read as the previous folder. A `wc` or `cat` that fails on a readable file prints an unrepeatable value.
- Graph creation warns about a rustfmt configuration file that rustfmt takes for crates from a folder above the repository, the home folder, or `rustfmt` in the configuration folder (`nx-rust/src/graph/rustfmt-config.ts`). It judges coverage from the folder of each target's `src_path`. Where an error other than a missing file stops rustfmt, it warns about nothing. It finds the configuration folder even where no home folder is known. A file that `HOME` or `XDG_CONFIG_HOME` places inside the repository gets its own wording and skips the crates whose folder holds it. The warning is recorded in project metadata as `formattingWarnings`, the executor prints it only at the start of `fmt-check` and `fmt` tasks, and no key holds it.
- Mara:
  - New evidence item `EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`: clippy, rustfmt, cargo's `[env]` with `relative` and `force`, and rustfmt's lookup per source file and on errors.
  - `DES-INPUTS`: the paragraph "Clippy's configuration folder", the tool-configuration row and the environment list.
  - `DES-DIAGNOSTICS`: a table row, the paragraph "Rustfmt configuration outside the repository", and "Warnings where they are seen".
  - `RISK-HOST-ENVIRONMENT`: the maintainer's answer of 22 Nov 2026 word for word. The folders above the repository are stated as following from his 14 Nov rule. His answers on restored binaries and on nxr-8akbay are recorded, citing `DES-INVOCATION` and the caching guide's "Sharing the cache between checkouts".
  - `VER-CACHE-KEYS` and `VER-SETUP`.
  - Caching guide: the tool-configuration row and the section "Rustfmt configuration outside the repository".
- Tests:
  - `nx-rust/test/clippy-conf-dir.spec.ts`, with the real Nx hasher: the environment variable as an absolute path, relative to the workspace root and through the parent folder; `.clippy.toml` beside `clippy.toml`; the variable unset; `[env]` naming a folder outside the repository, one inside it with `relative = true`, and one in the Cargo home, whose file draws the warning about Cargo configuration that Nx does not hash.
  - The same file checks the command's output, including a folder named `-` and several sources, and `configuredClippyFolders` for string and table values.
  - With a real `cargo clippy`, for the environment variable and for `[env]` naming folders outside and inside the repository: a cached passing `lint` runs again and fails after the threshold is lowered.
  - `nx-rust/test/rustfmt-config.spec.ts`, with a real rustfmt: home and XDG files warn in graph creation, `fmt-check` and `fmt`, not in `lint`, and change no key; a root `rustfmt.toml` silences the warning; a crate whose `[lib] path` leaves its own `rustfmt.toml` behind gets the warning; and an XDG folder inside one crate's folder gets the inside wording, for the other crates only.
  - Without the `[env]` folders, three clippy tests fail; judging from the manifest folder instead of `src_path` makes one rustfmt test fail.

Checks run on the final head, all passing: `pnpm nx format:write`; `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, evaluation complete); `zban check`; `pnpm nx run-many -t build lint test` (83 suites, 2128 tests); the two new spec files on Cargo 1.91.0 through a private `RUSTUP_HOME` (7 and 5 tests) and in the CI environment (`CI=true GITHUB_ACTIONS=true`, agent variables removed); `pnpm nx e2e nx-rust-e2e` (27 tests). CI on the pull request covers the rest.

## Decisions made

- The clippy input prints both `.clippy.toml` and `clippy.toml` of the first folder that holds either, instead of deciding which one clippy takes (`DES-INPUTS`).
- It prints the configuration for every source of `CLIPPY_CONF_DIR`: the task's environment and each `[env]` value of the Cargo configuration, without cargo's precedence and `force` between them. The key changes whenever any of them changes, which runs more than needed but never less (`DES-INPUTS`).
- `[env]` values are read when the graph is created, with the existing walk, and written into the command. A file outside the repository that sets them is the accepted `RISK-HOST-ENVIRONMENT`, and the existing warning names it as it names any `[env]` (`DES-INPUTS`).
- The clippy input is a POSIX shell runtime input. With nothing set, it prints nothing and starts no program besides the shell that Nx starts for every runtime input. It prints no path. It prints fixed lines where clippy fails or uses its defaults whatever the key holds, and an unrepeatable value where reading a readable file fails (`DES-INPUTS`).
- The existing `env` input on `CLIPPY_CONF_DIR` and the `clippy.toml` file inputs stay; they only split keys more often than needed (`DES-INPUTS`).
- The rustfmt warning covers the per-user files, per the maintainer's answer of 22 Nov, and a file in a folder above the repository, which follows from his rule of 14 Nov for configuration outside the repository (decided by the control plane in review; `RISK-HOST-ENVIRONMENT`, `DES-DIAGNOSTICS`).
- The rustfmt warning is printed only by `fmt-check` and `fmt` tasks. Coverage is judged per target source file (`src_path`). The lookup stops without a warning where rustfmt would fail. A path through something that is no folder counts as missing, as in rustfmt 1.100. `HOME` and `XDG_CONFIG_HOME` come from the graph's environment. On macOS the lookup uses `Library/Application Support`, which is reasoned and not run (`DES-DIAGNOSTICS`).
- A per-user file inside the repository skips the crates whose folder holds it and words the warning for the others (`DES-DIAGNOSTICS`). An ignored such file is filed as nxr-d5d0w5.
- A `clippy.toml` above the repository that clippy takes while `CLIPPY_CONF_DIR` is unset: the maintainer chose to warn after rc.2 (nxr-8akbay, recorded in `RISK-HOST-ENVIRONMENT`).
