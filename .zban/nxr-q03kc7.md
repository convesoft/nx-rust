---
title: Make the guidance agree on which warnings are in a cache key
status: todo
type: task
created_at: 2026-11-22T18:25:41Z
---

Cites: `DES-DIAGNOSTICS`, `VER-SETUP`, `RISK-HOST-ENVIRONMENT`, `GOAL-TRUSTED-CACHE`.

Reported by the maintainer on 22 November 2026, after 1.0.0-rc.2 was published; checked by reading at 3e7964d, not reproduced with a `~/.cargo/config.toml`. The behaviour is as designed: `DES-DIAGNOSTICS` ("Cargo configuration that Nx does not hash", "Rustfmt configuration outside the repository") keeps these two warnings out of the digest of "Warnings where they are seen" and out of every key, and `VER-SETUP` checks it. Only the guidance above the items disagrees with itself. Both general sentences date from #67 and were not narrowed when the two warnings were taken out of the keys.

- `nx-rust/docs/caching.mara.md`, "What is in a cache key": says a crate's warnings count for its keys and gives "your Cargo home" as the example of a path outside the repository that gives machines different keys. It names no exception.
- `nx-rust/docs/setup.mara.md`, "Error messages and warnings": says a crate's warnings are part of its tasks' keys, and in the same point speaks of the warning about the Cargo home's `config.toml`.
- `nx-rust/docs/caching.mara.md`, "Cargo configuration that Nx does not hash" and "Rustfmt configuration outside the repository": say these warnings stay out of the keys.

- [ ] In both general passages, say that the warnings about Cargo and rustfmt configuration that Nx does not hash are the exception, with a link to their sections, and give an example of an outside path that does reach a key, as `VER-SETUP` names one
- [ ] Say in "Error messages and warnings" what the sentence about the daemon means for a warning that is in no key: when it appears and goes away, and that a cache hit can replay an earlier state of it (`DES-DIAGNOSTICS`, "Limit")
- [ ] Look for the same general statement in `nx-rust/PLUGIN.md`, `nx-rust/README.md` and the other pages of `nx-rust/docs/`, and correct it there too
- [ ] Change no Mara item's meaning; if an item's text itself disagrees with `DES-DIAGNOSTICS`, stop and report it

Done when: the guidance of `caching.mara.md` and `setup.mara.md` says one thing about which warnings are in a cache key, in agreement with `DES-DIAGNOSTICS` and `VER-SETUP`, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
