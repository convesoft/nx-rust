---
title: A cached doc can be restored into an artifact directory that another workspace has come to share under the Nx daemon
status: cancelled
type: bug
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-3tf0pz
created_at: 2026-11-14T08:59:15Z
closed_at: 2026-11-14T09:12:24Z
---

Goal: a cached `doc` is never restored into an artifact directory that another Cargo workspace shares, also where the sharing began after Nx created the graph.

`DES-OUTPUTS` leaves `doc` uncached where two workspaces share one artifact directory, because Nx restores a folder output by replacing it, so restoring one workspace's `doc` folder deletes the other's pages. Graph creation decides that. Under the Nx daemon, a change to a Cargo configuration file outside the repository (the Cargo home's, or one above the repository) can point a second workspace at the first one's directory without a new graph. The check of nxr-3tf0pz compares each task's own artifact directory with the one its outputs name, so the second workspace's `build` and `doc` fail with the `nx reset` message. The first workspace's directory has not changed, though: its artifact input prints the same text, its cached `doc` gets a cache hit, and the restore replaces the shared `doc` folder, deleting pages that a plain `cargo doc` wrote there for the second workspace.

Found by reading the code while working on nxr-3tf0pz; not reproduced.

- [ ] Reproduce with the daemon: `two-workspaces`, with `build.target-dir` for `tools` set in a configuration file outside the repository and then changed to the root workspace's directory, `cargo doc` in `tools/`, then `nx run cargo-workspace:doc`
- [ ] Decide with the maintainer whether this needs a check, for example the artifact input or the executor telling whether another workspace's report names the same directory, and update `DES-OUTPUTS` and `DES-INPUTS`
- [ ] Implement it with a test that runs the real Nx with its daemon

Done when: the reproduction restores no `doc` folder over the other workspace's pages, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Reasons for Cancelling

The control plane decided, at the maintainer's request that by-products be settled in the task they were found in, that this is a stated limit and needs no code. Under the daemon, once a configuration file outside the repository has made a second workspace share the first one's artifact directory, a cache hit of the first workspace's `doc` can replace the shared `doc` folder and remove pages that a plain `cargo doc` wrote there for the second workspace. No task result is wrong. The second workspace's own cached tasks already fail with the `nx reset` message (nxr-3tf0pz), and once the graph is created again `doc` is uncached for both, as `DES-OUTPUTS` says. `DES-OUTPUTS` now states this limit, in the pull request of nxr-3tf0pz, where this issue is cancelled.
