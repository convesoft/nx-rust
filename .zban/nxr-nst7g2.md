---
title: Say what to do in the unknown-option line for an option passed on the command line
status: todo
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-wwm6br
created_at: 2026-11-14T07:39:44Z
---

Goal: the line that a task writes for an option it ignores says what the user can do also when the option was passed on the command line, as `DES-DIAGNOSTICS` promises for every diagnostic (row "An option that a task's executor does not know, ...") and `VER-UNKNOWN-OPTIONS` now requires.

Context: found while checking the remedy of the diagnostics that verification items other than `VER-SETUP` name (nxr-wwm6br). `ignoredOptionLine` in `nx-rust/src/executors/task-options.ts` writes three forms for the command line, and none says what to do:

```
api:test: ignoring option `coverage`, passed on the command line.
api:test: ignoring option `targetTriple`, which this target does not take, passed on the command line.
api:test: ignoring the positional arguments ["3000"] (option `_`), passed on the command line.
```

The form for an option from the workspace's configuration names the command that finds it and the fixes. `DES-UNKNOWN-OPTIONS` (paragraph "Source") gives the command-line form as an example without a remedy, and the user guide in `nx-rust/docs/targets.mara.md` quotes all three lines. What to suggest needs a decision: leaving the flag out fits an option that has no effect, but a user who typed positional words for a `test` may have meant arguments for the test binary, which the plugin has no way to pass, and for `run` the words belong after `--` or in `--args`.

- [ ] Decide what each of the three forms suggests, with the maintainer, and record it in `DES-UNKNOWN-OPTIONS` and the user guide
- [ ] Add the sentence to `ignoredOptionLine`
- [ ] Assert it in `nx-rust/test/unknown-options.spec.ts` (`fromCommandLine`, `wordsFromCommandLine`, `notTakenFromCommandLine`)

Done when: each command-line form says what the user can do, the tests check it, and `mara project validate` and `pnpm nx run-many -t build lint test` pass.
