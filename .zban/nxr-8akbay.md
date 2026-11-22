---
title: Warn about a clippy.toml above the repository that clippy takes
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-rpcfg4
created_at: 2026-11-22T11:54:12Z
---

Cites: `RISK-HOST-ENVIRONMENT`, `DES-DIAGNOSTICS`, `EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`.

Where `CLIPPY_CONF_DIR` is unset, clippy looks for `.clippy.toml` and `clippy.toml` from the crate's folder up to the file system's root (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`). If no folder of the repository holds one, it takes a file in a folder above the repository, such as the home folder when the repository lies below it. Nx does not hash that file and the plugin does not warn about it; `RISK-HOST-ENVIRONMENT` accepts it silently (nxr-rpcfg4 recorded this).

Clippy has no per-user configuration folder, so this case is rarer than rustfmt's, and the maintainer's 22 Nov 2026 answer named only Cargo and rustfmt configuration.

- [ ] Ask the maintainer whether `lint` should warn about such a file, as `fmt-check` and `fmt` warn about a rustfmt configuration outside the repository (`DES-DIAGNOSTICS`)
- [ ] If so, update `DES-DIAGNOSTICS` and `RISK-HOST-ENVIRONMENT` and implement the warning beside `rustfmtConfigurationWarnings` in `nx-rust/src/graph/rustfmt-config.ts`
