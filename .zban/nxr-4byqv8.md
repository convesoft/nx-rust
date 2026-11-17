---
title: Keep selection for a test task that Nx hashes while another task's cargo-affected status runs
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-tabkjx
created_at: 2026-11-16T21:57:46Z
---

Goal: a `test` task in affected mode keeps its selection where Nx hashes it while another task of the same command runs `cargo affected status`.

Context: `status` writes to cargo-affected's database through a `-wal` file while it runs (`EVD-TEST-MODE-GUARD`), so the mode command prints `full` for a task hashed meanwhile, and the guard of `DES-TEST-MODE` ("Between hashing and the run") then runs that task's full suite. Nx hashes the `test` of a crate when its dependencies have ended, so this concerns a task whose other dependencies, such as a `build` it waits for, end while another `test` already runs. It is safe and costs only the savings of such tasks.

- [ ] Measure how often it happens in a parallel `nx affected -t test` on a workspace with binaries
- [ ] If it matters, find a way that keeps `DES-TEST-MODE` safe, such as running `status` before the command hashes its tests, and update `DES-TEST-MODE`
