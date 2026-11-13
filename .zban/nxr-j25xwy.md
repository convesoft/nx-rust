---
title: Check what Nx Cloud's ultracache does to Rust targets' inputs
status: todo
type: task
tags:
  - spike
parent: nxr-nm0jd6
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:50Z
---

Goal: know what Nx 24's `ultracache` target setting does to the inferred Rust targets when a workspace uses Nx Cloud, and decide whether they should set `ultracache.mode` to `warn`.

`EVD-NX-24-FILE-INPUTS` records what the installed typings say: the mode defaults to `on`, where a recording of the task's reads stands in for its declared inputs and outputs; `warn` records and reports undeclared reads but hashes and caches from the declared inputs; it is Nx Cloud only and the open-source runner records nothing. Nobody has run it. If `on` replaced the declared inputs of `DES-INPUTS` (the toolchain and test-mode runtime inputs, environment inputs, `fileInputs`), keys could miss what the plugin declares on purpose (`GOAL-TRUSTED-CACHE`).

- [ ] Find out, with Nx Cloud or from Nx's documentation and source, when a recording replaces declared inputs and what it records for a cargo process tree, including runtime and `env` inputs and the `always` flag on filesets
- [ ] Record the result as an evidence item and update the risks and designs it concerns
- [ ] Decide with the user whether inferred Rust targets set `ultracache.mode` (for example `warn`), and specify it in `DES-TARGETS` or `DES-INPUTS`

Done when: the evidence item is accepted, the user has agreed to the decision, and `mara schema validate` and `mara project validate` report `valid: true`.
