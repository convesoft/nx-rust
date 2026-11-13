---
title: Two end-to-end runs that write their registry tokens at the same moment can lose one, and that run cannot publish
status: todo
type: bug
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:37Z
---

Goal: two `pnpm nx e2e nx-rust-e2e` runs in different checkouts that start at about the same time can both publish the plugin to their local registries.

Found while working on nxr-3h5eg2 on 13 November 2026, with npm 11 (the one Node 26 ships), Nx 24.0.6 and verdaccio 6.11.1 on Linux.

`useRegistry` in `tools/scripts/local-registry.ts` runs `npm config set //localhost:<port>/:_authToken …`, and the stop function runs `npm config delete` for the same key. Both write the user's shared `~/.npmrc`, so all checkouts and agents of the user share it. `npm config` reads the file, changes its copy and writes the whole file back, with no lock. When two of these commands run at the same moment, the last write drops the other's change:

- Two concurrent `npm config set` of different keys on one scratch npmrc (`npm_config_userconfig`, not the shared file) kept only one of the two keys in 10 of 10 rounds.
- With two registries started at the same moment on different ports (the reproduction in nxr-3h5eg2, with high ports), one run's `npm publish` failed with `ENEEDAUTH ... This command requires you to be logged in to http://localhost:<port>/` in 3 of 6 rounds, and in 1 of 3 rounds with the code before nxr-3h5eg2.
- A `config delete` that runs while another run's `config set` does can also drop that run's token, or leave its own in place.

The run fails loudly in the global setup rather than testing the wrong plugin, but it fails.

- [ ] Choose how a run gives npm its registry token without a shared read-modify-write, for example an npm user configuration of its own (`npm_config_userconfig`) under `tmp/local-registry/` or a lock around the writes, and check what the tests need from the user's `~/.npmrc`
- [ ] Show that two runs whose registries start at the same moment both publish, and that `~/.npmrc` keeps no token afterwards
