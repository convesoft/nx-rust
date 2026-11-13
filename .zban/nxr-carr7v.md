---
title: Make VER-SETUP check init's writes, generator mechanics and diagnostic content in full
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-eg9s2w
  - nxr-q6cxt3
discovered_from: nxr-dp5q0f
created_at: 2026-11-13T11:50:39Z
---

Goal: `VER-SETUP` (`nx-rust/docs/verification.mara.md`) checks the promises of `DES-GENERATORS` and `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) closely enough that an implementation that breaks one of them cannot pass. nxr-eg9s2w and nxr-q6cxt3 implement what `VER-SETUP` checks.

Context: the third review of pull request #9 (nxr-dp5q0f) found no defects but listed these lesser gaps in how thorough `VER-SETUP` is. They were left out of that pull request so that no Mara item changed after the review. Read the cited items rather than copying their text here.

- [ ] **Stop before writing.** The check that `init` stops before it writes asserts only the final state of `nx.json`. An implementation that writes the entry and rolls it back, or writes another file on the error path, would pass. Observe writes, or assert that nothing in the repository changed. Run a failing second `init` on a `nx.json` that already lists the plugin, to show that an existing entry does not bypass the checks (`DES-GENERATORS`, steps 1 and 2).
- [ ] **Generator mechanics** that `DES-GENERATORS` promises and no check names:
  - `directory` required and the first positional argument, `name` and `edition` optional;
  - the nearest enclosing workspace chosen when workspaces are nested (`EVD-CARGO-NEW`);
  - no cargo call when the enclosing workspace's `exclude` matches the folder;
  - creation through the callback the generator returns, not through Nx's file tree;
  - cargo alone editing the workspace manifest.
- [ ] **Generator fixtures:** an omitted `name`, cargo's default edition where `[workspace.package]` sets none, and inherited `[workspace.lints]` (`DES-GENERATORS`, `EVD-CARGO-NEW`).
- [ ] **Diagnostic content and boundary cases** from `DES-DIAGNOSTICS`:
  - the warning under `NX_RUST_ALLOW_UNSUPPORTED_NX` says that the major is untested;
  - messages carry no error codes (`ADR-NO-ERROR-CODES`);
  - every diagnostic names a remedy;
  - the override changed while a daemon runs (`EVD-NX-24-SETUP`);
  - a negative case for the directory warning in which only `.gitignore` covers the directory;
  - an explicit fixture for a collision with another plugin's project (`DES-PROJECT-GRAPH`);
  - a direct count of cargo calls with an unsupported Cargo.
- [ ] **Cross-references** from `VER-SETUP` to `VER-TESTING` and `VER-ARTIFACTS`, which check two task-time diagnostics of `DES-DIAGNOSTICS`: an invalid `NX_RUST_TEST_MODE` and mismatched `wasm-bindgen` versions.

Done when: `VER-SETUP` covers each point above, the user has agreed to any change in what it requires, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.
