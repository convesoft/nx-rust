---
title: Do not fail graph creation for a path dependency that cargo builds but does not report
status: todo
type: bug
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:41:55Z
---

Goal: a path dependency without a project that cargo builds never makes graph creation fail.

`DES-METADATA-REPORT` requests a report for a path dependency without a project to follow the path dependencies behind it. Checked on 2026-11-13 with cargo 1.100.0: workspace `w1` with member `app`, which depends on `x = { path = "../../w2/stray" }`; `w2/Cargo.toml` is a workspace with `members = []`, and `w2/stray` holds `x` without `[workspace]`. `cargo check` in `w1` succeeded, while `cargo metadata --no-deps --manifest-path ../w2/stray/Cargo.toml` in `w1` failed with "current package believes it's in a workspace when it's not", as `EVD-CARGO-REDIRECTIONS` records for a patched crate. If Nx does not hand `w2/stray/Cargo.toml` to the plugin (ignored or excluded), the plugin's report of the path dependency fails, and so does graph creation. For crates that `[patch]` or `[replace]` redirect to, nxr-p5ybc0 already goes on with a warning; path dependencies were left as they are.

- [ ] Reproduce it through Nx graph creation with the stray crate excluded
- [ ] Decide with the user whether a path dependency gets the same treatment as a redirected crate (warning, folder as input, path dependencies behind it not followed), and record it in `DES-METADATA-REPORT` and `DES-DIAGNOSTICS`
- [ ] Implement it with a test

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
