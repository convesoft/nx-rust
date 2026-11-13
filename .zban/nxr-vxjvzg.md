---
title: Decide what Rust targets do when Nx has no node for the plugin's package
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-pn1hwr
created_at: 2026-11-13T12:00:03Z
---

Goal: settle with the user what happens when the `externalDependencies` input of `DES-INPUTS` names `@convesoft/nx-rust` and the Nx graph has no node for that package.

By `EVD-NX-24-EXTERNAL-NODES`, Nx 24.0.6 then fails to hash every such task ("The externalDependency … could not be found"). That happens when `nx.json` sets `pluginsConfig["@nx/js"].analyzeLockfile` to `false`, which leaves the graph without npm nodes, and probably when the plugin is loaded from a path rather than installed as a package (not tested). The maintainer's answer to question 7 of nxr-pn1hwr covers the input, not this case.

Options found so far:

1. When `nx.json` switches lockfile analysis off, declare `externalDependencies: []` instead and say so: a plugin upgrade then no longer changes Rust keys in that repository.
2. Fail graph creation with a message that asks to switch lockfile analysis on.
3. Carry the plugin's version in the target configuration instead of an `externalDependencies` input, which works without npm nodes but is a new kind of input.

Recommendation of the worker of nxr-pn1hwr: option 1, with the message in `DES-DIAGNOSTICS`.

- [ ] Agree the behaviour with the user
- [ ] Write it into `DES-INPUTS` and, for a message, `DES-DIAGNOSTICS`, with the verification the Mara policies then require

Done when: the user has agreed, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
