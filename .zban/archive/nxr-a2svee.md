---
title: Two end-to-end runs that write their registry tokens at the same moment can lose one, and that run cannot publish
status: done
type: bug
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:37Z
closed_at: 2026-11-13T18:38:01Z
---

Goal: two `pnpm nx e2e nx-rust-e2e` runs in different checkouts that start at about the same time can both publish the plugin to their local registries.

Found while working on nxr-3h5eg2 on 13 November 2026, with npm 11 (the one Node 26 ships), Nx 24.0.6 and verdaccio 6.11.1 on Linux.

`useRegistry` in `tools/scripts/local-registry.ts` runs `npm config set //localhost:<port>/:_authToken …`, and the stop function runs `npm config delete` for the same key. Both write the user's shared `~/.npmrc`, so all checkouts and agents of the user share it. `npm config` reads the file, changes its copy and writes the whole file back, with no lock. When two of these commands run at the same moment, the last write drops the other's change:

- Two concurrent `npm config set` of different keys on one scratch npmrc (`npm_config_userconfig`, not the shared file) kept only one of the two keys in 10 of 10 rounds.
- With two registries started at the same moment on different ports (the reproduction in nxr-3h5eg2, with high ports), one run's `npm publish` failed with `ENEEDAUTH ... This command requires you to be logged in to http://localhost:<port>/` in 3 of 6 rounds, and in 1 of 3 rounds with the code before nxr-3h5eg2.
- A `config delete` that runs while another run's `config set` does can also drop that run's token, or leave its own in place.

The run fails loudly in the global setup rather than testing the wrong plugin, but it fails.

- [x] Choose how a run gives npm its registry token without a shared read-modify-write, for example an npm user configuration of its own (`npm_config_userconfig`) under `tmp/local-registry/` or a lock around the writes, and check what the tests need from the user's `~/.npmrc`
- [x] Show that two runs whose registries start at the same moment both publish, and that `~/.npmrc` keeps no token afterwards

## Summary of Changes

How a run now gives npm its token: through the environment, as it already gave pnpm its token. npm takes a key that starts with `//` unchanged from the name of an `npm_config_*` variable (`@npmcli/config`: "don't normalize nerf-darted keys"). So `useRegistry` in `tools/scripts/local-registry.ts` sets `npm_config_//localhost:<port>/:_authToken` next to `npm_config_registry` and the two `pnpm_config_*` variables, and no longer runs `npm config set`. The stop function no longer runs `npm config delete`; it only stops the registry. The setup writes no npm configuration file at all, so runs share nothing they could overwrite, and a stop can no longer delete another run's token (the case found in the review of #39).

This was chosen over a user configuration of the run's own (`npm_config_userconfig`) because it needs no file and changes nothing else that npm reads. What the tests need from `~/.npmrc`: nothing. It did not exist on this machine. CI's `actions/setup-node` step has no `registry-url`, so it writes none. npm and pnpm talk only to the local registry, and verdaccio reaches npmjs.org through its own configuration.

Findings:

- With the token only in `npm_config_//localhost:44873/:_authToken`, npm 10.9.3, 11.19.1, 11.20.0, 12.2.1 and 12.2.2 published to a scratch verdaccio. Without it they failed with `ENEEDAUTH`.
- The suite's own publish step needs no token. `releasePublish` runs `pnpm publish`, because Nx finds `pnpm-lock.yaml`, and pnpm 12.18.0 published to the scratch verdaccio with no token anywhere. The `ENEEDAUTH` failures in the nxr-3h5eg2 reproduction came from that driver's own `npm publish`. The setup still gives npm the token.

Checks run:

- Concurrency, on ports 44873 and up. A driver started the registry through `startLocalRegistry` with its own Nx workspace data, Nx cache and storage and `NX_DAEMON=false`. It published a package with `npm publish`, which needs the token, then published the plugin with `releasePublish`, and stopped. Each round started two drivers at the same moment from this checkout, sharing one scratch npm user configuration (`npm_config_userconfig`) in place of `~/.npmrc`.
  - With the code from `origin/main` (4 rounds), both publishes succeeded every time. But in 3 of the 4 rounds the shared file still held a token after both runs had stopped, because one of two concurrent `npm config delete` calls was lost.
  - With this change, 6 rounds started from first ports 44873 and 44883, and 6 rounds started both runs from 44873 (one run moved to 44874 each time). All 24 `npm publish` and all 24 `releasePublish` calls succeeded, each into its own run's storage. The shared file was never created, and nothing listened on 44873–44899 afterwards.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache` passed twice in a row, as CI runs it; the second run used port 4873 and passed 24 of 24 tests. `~/.npmrc` did not exist before or after, and nothing listened on 4873–4899 afterwards.
- `tools/scripts/` type-checks with the options of `nx-rust-e2e/tsconfig.spec.json` and with `--strict --noUnusedLocals --noUnusedParameters`.
- `pnpm nx run-many -t build lint test` (608 tests), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, no errors or warnings) and `zban check` pass. No Mara item changed.
