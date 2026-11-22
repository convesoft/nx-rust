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

- `lint` has a new runtime input (`clippyConfigurationCommand` in `nx-rust/src/graph/clippy-input.ts`). When `CLIPPY_CONF_DIR` is set, the command starts in the workspace root and looks in the named folder and the folders above it, as clippy does. In the first folder that holds `.clippy.toml` or `clippy.toml`, it prints each of the two files with its name, size and content. When the variable is unset, it prints nothing.
- Graph creation now warns about a rustfmt configuration file outside the repository that rustfmt takes for crates: one in a folder above the repository, in the home folder, or in `rustfmt` of the configuration folder (`nx-rust/src/graph/rustfmt-config.ts`). The warning goes into project metadata as `formattingWarnings`. The executor prints it only at the start of `fmt-check` and `fmt` tasks, and no key holds it.
- Mara: new evidence item `EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`. Updated `DES-INPUTS` (new paragraph "Clippy's configuration folder", the tool-configuration row and the environment list), `DES-DIAGNOSTICS` (new table row, new paragraph "Rustfmt configuration outside the repository", and "Warnings where they are seen"), `RISK-HOST-ENVIRONMENT` (the maintainer's 22 Nov 2026 answer, word for word), `VER-CACHE-KEYS` and `VER-SETUP`. Caching guide: the tool-configuration row and a new section "Rustfmt configuration outside the repository".
- Tests: `nx-rust/test/clippy-conf-dir.spec.ts` uses the real Nx hasher with absolute, relative and parent-folder lookups, `.clippy.toml` beside `clippy.toml`, and the variable unset. It also checks the command's output directly, and runs a real `cargo clippy`: a cached passing `lint` runs again and fails after the threshold is lowered. `nx-rust/test/rustfmt-config.spec.ts` covers `~/.rustfmt.toml` and `$XDG_CONFIG_HOME/rustfmt/rustfmt.toml` with a real rustfmt: graph creation, `fmt-check` and `fmt` print the warning, `lint` does not, no key changes, and a root `rustfmt.toml` silences the warning. With the new runtime input removed, two of the three clippy tests fail.

Checks run: `pnpm nx run-many -t build lint test` passed (83 suites, 2122 tests). `pnpm nx e2e nx-rust-e2e` passed. `pnpm nx format:check --all` passed. `mara schema validate` and `mara project validate` passed (valid, evaluation complete). `zban check` passed. The two new spec files also passed with Cargo 1.91.0 through a private `RUSTUP_HOME`, and in the CI environment (`CI=true GITHUB_ACTIONS=true` with the agent variables removed). CI on the pull request covers the rest.

## Decisions made

- The clippy input prints both `.clippy.toml` and `clippy.toml` of the first folder that holds either, instead of deciding which one clippy takes. Experiments show `.clippy.toml` wins, but the key follows the file either way, and the plugin repeats no precedence rule. Recorded in `DES-INPUTS`.
- The clippy input is a POSIX shell runtime input, not a Node script. With the variable unset it starts no extra process and prints nothing. It prints no path, so other checkouts share keys. It prints fixed lines where clippy fails or uses its defaults whatever the key holds, and an unrepeatable value where a read fails unexpectedly. Recorded in `DES-INPUTS`.
- A relative `CLIPPY_CONF_DIR` is resolved from the workspace root, where cargo runs clippy-driver (evidence). Recorded in `DES-INPUTS`.
- The existing `env` input on `CLIPPY_CONF_DIR` and the `clippy.toml` file inputs stay. They split keys more often than needed but never less. Recorded in `DES-INPUTS`.
- The rustfmt warning covers any rustfmt file outside the repository that rustfmt takes, including one in a folder above the repository, not only the per-user locations, because rustfmt takes it for the same reason. Recorded in `RISK-HOST-ENVIRONMENT` and `DES-DIAGNOSTICS`.
- The rustfmt warning is printed only by `fmt-check` and `fmt` tasks, not by every task of the workspace as the Cargo warning is, because only rustfmt reads the file. Whether a crate is covered is judged from the folder of its manifest. The lookup uses `HOME` and `XDG_CONFIG_HOME` of the graph's environment; on macOS it uses `Library/Application Support`, which is reasoned and not run. Recorded in `DES-DIAGNOSTICS`.
- A `clippy.toml` above the repository that clippy takes when `CLIPPY_CONF_DIR` is unset stays within `RISK-HOST-ENVIRONMENT` without a warning. Filed as the deferred backlog issue nxr-8akbay.
