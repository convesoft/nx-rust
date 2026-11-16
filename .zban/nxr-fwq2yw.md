---
title: Fail before cargo, with a clear message, where a file replaced the lockfile task
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-ym403k
created_at: 2026-11-16T12:55:18Z
---

Where a `project.json` target or `package.json` script in a Cargo workspace's folder replaces the lockfile task (`DES-LOCKFILE-HASHING`, "Merged project"; `EVD-NX-MIXED-CONSUMER`, "The lockfile task replaced"), a crate's cached task runs cargo and then fails in the check after cargo, with a message that blames a change of `Cargo.lock` during the run. The result is safe (Nx stores nothing), but the cargo call is wasted and the message points the wrong way. Exotic: it needs a script or target named `lockfile` in the workspace's folder, and the documented fix is `targetNames`.

- [ ] Find out why the executor (`keyHoldsDigests` in `nx-rust/src/executors/task.ts`) takes the replaced target for the lockfile task, although `nx graph` shows no plugin metadata on it
- [ ] Treat a dependency as the lockfile task (and the drift check under `hakari`) only where its target runs the plugin's executor, and otherwise fail before cargo with a message that names the workspace project's target, says that a file in its folder replaced it, and gives the `targetNames` fix
- [ ] Update `DES-LOCKFILE-HASHING` ("Merged project") and the sentence of `VER-CACHE-KEYS` about the replaced lockfile task, and extend the test in `nx-rust/test/mixed-projects.spec.ts` to the message and to cargo not running
