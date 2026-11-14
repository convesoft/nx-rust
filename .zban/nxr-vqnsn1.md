---
title: Say what to do in the warning about an included Cargo configuration file that is no valid TOML
status: in-progress
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-carr7v
created_at: 2026-11-13T21:26:47Z
---

Goal: the graph-time warning for a file that a Cargo configuration's `include` names and that is no valid TOML says what the user can do, as `DES-DIAGNOSTICS` promises for every diagnostic and `VER-SETUP` checks for each message it names.

Context: found while making `VER-SETUP` check the remedy of each diagnostic it names (nxr-carr7v). The warning, built in `nx-rust/src/cargo/redirections.ts` (`readRedirections`), reads:

```
nx-rust: <file>, which <config> includes, cannot be read: <reason>
nx-rust skips it, so a [patch] or paths entry in it gives no edges. Cargo 1.91 ignores include, and later versions fail on such a file.
```

It names the file and the consequence but gives no remedy, such as fixing the file's TOML or removing it from `include`. Every other warning that `VER-SETUP` names ends with one, and its test (`nx-rust/test/redirections.spec.ts`, "skips an included file that is no valid TOML, with a warning that names it") checks only the first line.

- [ ] Add a sentence that says what to do to the warning
- [ ] Assert it in the test above

Done when: the warning says what the user can do, the test checks that sentence, and `pnpm nx run-many -t build lint test` passes.
