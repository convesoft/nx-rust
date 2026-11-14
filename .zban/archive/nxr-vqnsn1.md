---
title: Say what to do in the warning about an included Cargo configuration file that is no valid TOML
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-carr7v
created_at: 2026-11-13T21:26:47Z
closed_at: 2026-11-14T07:46:26Z
---

Goal: the graph-time warning for a file that a Cargo configuration's `include` names and that is no valid TOML says what the user can do, as `DES-DIAGNOSTICS` promises for every diagnostic and `VER-SETUP` checks for each message it names.

Context: found while making `VER-SETUP` check the remedy of each diagnostic it names (nxr-carr7v). The warning, built in `nx-rust/src/cargo/redirections.ts` (`readRedirections`), reads:

```
nx-rust: <file>, which <config> includes, cannot be read: <reason>
nx-rust skips it, so a [patch] or paths entry in it gives no edges. Cargo 1.91 ignores include, and later versions fail on such a file.
```

It names the file and the consequence but gives no remedy, such as fixing the file's TOML or removing it from `include`. Every other warning that `VER-SETUP` names ends with one, and its test (`nx-rust/test/redirections.spec.ts`, "skips an included file that is no valid TOML, with a warning that names it") checks only the first line.

- [x] Add a sentence that says what to do to the warning
- [x] Assert it in the test above

Done when: the warning says what the user can do, the test checks that sentence, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

- `readConfig` in `nx-rust/src/cargo/redirections.ts`: the warning for an included file that cannot be read now ends with `Correct the file's TOML, or remove it from include in <config>.`
- `nx-rust/test/redirections.spec.ts`: "skips an included file that is no valid TOML, with a warning that names it and says what to do" checks that last line exactly.

Checks run: `pnpm nx run-many -t build lint test` (31 suites, 941 tests passed); the changed spec files again with `CI=true GITHUB_ACTIONS=true` and without the agent variables (350 tests passed); `pnpm nx format:check --all`; `mara schema validate`, `mara project validate` and `zban check`. The end-to-end suite was not run, because it does not check this warning.
