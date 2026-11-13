---
title: Two end-to-end runs whose registries start at the same moment in different checkouts share one registry
status: done
type: bug
tags:
  - tests
discovered_from: nxr-f6f9gh
created_at: 2026-11-13T15:25:35Z
closed_at: 2026-11-13T17:43:19Z
---

Goal: two `pnpm nx e2e nx-rust-e2e` runs in different checkouts of this repository that start at about the same time each publish to and install from a local registry of their own.

Found while working on nxr-f6f9gh on 13 November 2026, with Nx 24.0.6 and verdaccio 6.11.1 on Linux.

The `@nx/js:verdaccio` executor takes the first free port from 4873, which `detect-port` finds by binding the port and releasing it again; verdaccio then listens on it. Verdaccio logs `http address - http://localhost:<port>/` before `listen` succeeds, and `startLocalRegistry` in `tools/scripts/local-registry.ts`, like the `@nx/js` helper it replaced, takes that line as the sign that the registry started. When two checkouts start their registries within about a second of each other, both executors can take 4873. The verdaccio that loses exits with `cannot create http server: listen EADDRINUSE`, but by then both setups have pointed npm and pnpm at `http://localhost:4873`. The losing run then publishes `@convesoft/nx-rust@0.0.0-e2e` to the other checkout's registry, so one of the two publishes is rejected or a run tests the other checkout's build. The losing run logs `The local registry stopped unexpectedly: nx run @convesoft/nx-rust-source:local-registry exited with code 1.` and carries on.

Reproduced from a single checkout by starting the registry twice at once through `startLocalRegistry`, each with its own `NX_WORKSPACE_DATA_DIRECTORY` (so that Nx tracks the two tasks apart, as it does for two checkouts) and its own storage: in 2 of 3 rounds both reported port 4873, and one `nx run` exited with code 1 about a second later.

- [x] Make the setup confirm that its own registry listens before it publishes, and start again on another port when it lost the port
- [x] Show that two registries started at the same moment, as in the reproduction above, end up on different ports, and that each setup uses its own

## Summary of Changes

How the setup tells its registry from another one: it puts a file with random content in the storage folder it gave its own registry, under the package `nx-rust-e2e-registry-probe`, and asks the server on the port for that file (`GET /nx-rust-e2e-registry-probe/-/<random>.tgz`). Verdaccio serves a tarball it finds in its storage folder directly, so only a registry that keeps its packages in that folder can answer with the content. Another checkout's registry, with this code or the code before it, answers 404.

- `tools/scripts/local-registry.ts`: `startLocalRegistry` waits for the address as before, then asks for the file until the answer comes. If another server answers, or its own verdaccio exits with `EADDRINUSE`, it stops its `nx run`, logs why, and starts again with `--port <lost port + 1>`, at most 5 times. Other exits and 30 seconds without an answer fail with a message, as before. The setup writes the npm token and points npm and pnpm at the registry only after the proof, so a run that moves never wrote a token for the port it gave up. The stop function removes the token before it stops the registry: while its registry holds the port, no other run can have written that key. If the registry has already died, it leaves the token and says so. `startLocalRegistry` also takes an optional first port, used by the checks below. `storage` is resolved against the workspace root, as the executor does.
- `.verdaccio/config.yml`: the probe package has no uplink, so a registry that lacks the file answers 404 at once, without asking npmjs.org.

Checks run, the reproductions on ports 24873 and up so as not to meet other agents' runs on 4873. Each round started two driver processes at the same moment from this checkout, each with its own `NX_WORKSPACE_DATA_DIRECTORY`, storage and `NX_DAEMON=false`:

- With the code before this change (with only a first-port argument added), 2 of 3 rounds put both runs on 24873. The loser published into the winner's storage and logged `The local registry stopped unexpectedly ... exited with code 1`.
- With the change, 12 rounds (6 before and 6 after a final restructuring) ended on two different ports each time. In 7 of them both runs had taken 24873, and the loser logged `Port 24873 is taken by another server ... status 404` and moved to 24874. In every round, `ss -ltnp` showed that the process listening on each run's port descended from that run, and a file put in one run's storage was served on that run's port (200) and not on the other's (404). Every successful publish landed in the publishing run's own storage.
- The check itself, with a stand-in `nx run`: a server that answers 404 gives "another server"; a server that serves the storage gives "own"; a silent server, with the run's verdaccio exiting with `EADDRINUSE`, gives "another server" after 5 seconds; an exit for another reason fails at once; nothing answering fails after 30 seconds. The probe file is always removed.
- A second start that shares the first one's Nx workspace data (an orphan of the same checkout) still failed after 0.7 seconds with the "another Nx process in this checkout" message.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache` passed twice in a row (20 tests each, registry on 4873). Afterwards nothing listened on 4873 to 4899, no registry process of this checkout was left, and `~/.npmrc` held no token. `--skip-nx-cache` was needed because the `e2e` target's inputs do not cover these files (nxr-tfw30m). The first attempt failed in the global setup: Jest compiles it with the non-strict options of `nx-rust-e2e/tsconfig.spec.json`, where a truthiness narrowing that passed `tsc --strict` does not narrow. `Answer` now uses a string discriminant, and the scripts type-check with both option sets.
- `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, no errors or warnings) and `zban check` pass. No Mara item changed.

Found on the way:

- Concurrent `npm config set` calls on one npmrc lose writes (10 of 10 rounds on a scratch file). Two runs that write their tokens to the shared `~/.npmrc` at the same moment can therefore lose one, and that run's publish fails with `ENEEDAUTH`. This happened in 3 of 6 reproduction rounds that had no port race, and in 1 of 3 with the old code. Filed as nxr-a2svee.
- The `e2e` target's cache ignores changes to `tools/scripts/` and `.verdaccio/config.yml`: nxr-tfw30m.
- Nothing lints or type-checks `tools/scripts/` outside the e2e run: nxr-mjh503.
- nxr-r1b5wf is not settled: a passing run still logs `Failed to start verdaccio: undefined` when the teardown stops the registry, and a run that moves logs the line once more for the registry it gave up.
