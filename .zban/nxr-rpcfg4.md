---
title: Hash CLIPPY_CONF_DIR file content and warn on per-user rustfmt config
status: todo
type: bug
priority: high
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
---

Cites: `DES-INPUTS`, `DES-DIAGNOSTICS`, `RISK-HOST-ENVIRONMENT`, `GOAL-TRUSTED-CACHE`, `VER-CACHE-KEYS`.

Two cache-configuration findings from adopting `1.0.0-rc.1` in `mara`:

1. `lint` declares `{ env: "CLIPPY_CONF_DIR" }` in `nx-rust/src/graph/inputs.ts`, which hashes only the directory path string and misses edits to `clippy.toml` or `.clippy.toml` inside that directory (reproduced on `rc.1`: changing `too-many-arguments-threshold` restored a cached pass).
2. Maintainer decision (22 Nov 2026): keep external Cargo config (`$CARGO_HOME/config.toml`, etc.) and per-user Rustfmt config (`$XDG_CONFIG_HOME/rustfmt/rustfmt.toml`, `~/.config/rustfmt/rustfmt.toml`, `~/.rustfmt.toml`) accepted under `RISK-HOST-ENVIRONMENT` rather than hashing them into cache keys, and emit the same clear graph-creation warning for per-user Rustfmt configuration outside the repository that the plugin already emits for external Cargo configuration.

- [ ] Check real `cargo clippy` precedence between `clippy.toml` and `.clippy.toml` in `CLIPPY_CONF_DIR` and real `rustfmt` precedence for per-user config files outside the repository
- [ ] Update `DES-INPUTS`, `DES-DIAGNOSTICS` and `RISK-HOST-ENVIRONMENT` (with evidence as needed)
- [ ] Hash the selected Clippy configuration file's content in `lint`'s key when `CLIPPY_CONF_DIR` is set (handling missing/unreadable paths safely and keeping keys unchanged when `CLIPPY_CONF_DIR` is unset)
- [ ] Emit a clear graph-creation warning when a per-user `rustfmt.toml` outside the repository applies, matching the external Cargo config warning style
- [ ] Add tests using the real Nx hasher and real `cargo clippy` / `rustfmt` covering `CLIPPY_CONF_DIR` content invalidation and per-user rustfmt warning behaviour

Done when: editing the Clippy config file selected by `CLIPPY_CONF_DIR` invalidates `lint`'s cache key, per-user rustfmt config emits a clear graph-creation warning, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.
