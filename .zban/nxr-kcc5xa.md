---
title: Decide which error a name collision across two plugin entries gives
status: todo
type: task
priority: low
tags:
  - spec
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:31Z
---

Goal: the knowledge says what happens when two projects of the plugin with one name come from two entries of the plugin in `nx.json`.

`REQ-PROJECT-NAMES` and `DES-PROJECT-GRAPH` have two projects of this plugin with one name fail graph creation with the plugin's error, naming both manifests and the remedies. Each entry's `createNodes` checks the names of its own projects only: with plugin isolation on, Nx runs the entries in separate processes, and `DES-METADATA-REPORT` and `EVD-NX-PLUGIN-ENTRIES` keep what one entry found from the other. Two crates with one name whose manifests two entries receive therefore fail with Nx's own "The following projects are defined in multiple locations", which names both folders, not manifests, and recommends a `project.json`.

- [ ] Decide with the user whether that is acceptable and say so in `DES-PROJECT-GRAPH`, or design a check across entries
- [ ] Add the case to `VER-GRAPH` and a test with two entries

Done when: the items say what happens, the tests check it, and `mara schema validate` and `mara project validate` report `valid: true`.
