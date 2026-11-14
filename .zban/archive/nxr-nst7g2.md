---
title: Say what to do in the unknown-option line for an option passed on the command line
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-wwm6br
created_at: 2026-11-14T07:39:44Z
closed_at: 2026-11-14T10:00:44Z
---

Goal: the line that a task writes for an option it ignores says what the user can do also when the option was passed on the command line, as `DES-DIAGNOSTICS` promises for every diagnostic (row "An option that a task's executor does not know, ...") and `VER-UNKNOWN-OPTIONS` now requires.

Context: found while checking the remedy of the diagnostics that verification items other than `VER-SETUP` name (nxr-wwm6br). `ignoredOptionLine` in `nx-rust/src/executors/task-options.ts` writes three forms for the command line, and none says what to do:

```
api:test: ignoring option `coverage`, passed on the command line.
api:test: ignoring option `targetTriple`, which this target does not take, passed on the command line.
api:test: ignoring the positional arguments ["3000"] (option `_`), passed on the command line.
```

The form for an option from the workspace's configuration names the command that finds it and the fixes. `DES-UNKNOWN-OPTIONS` (paragraph "Source") gives the command-line form as an example without a remedy, and the user guide in `nx-rust/docs/targets.mara.md` quotes all three lines. What to suggest needs a decision: leaving the flag out fits an option that has no effect, but a user who typed positional words for a `test` may have meant arguments for the test binary, which the plugin has no way to pass, and for `run` the words belong after `--` or in `--args`.

- [x] Decide what each of the three forms suggests, with the maintainer, and record it in `DES-UNKNOWN-OPTIONS` and the user guide
- [x] Add the sentence to `ignoredOptionLine`
- [x] Assert it in `nx-rust/test/unknown-options.spec.ts` (`fromCommandLine`, `wordsFromCommandLine`, `notTakenFromCommandLine`)

Done when: each command-line form says what the user can do, the tests check it, and `mara project validate` and `pnpm nx run-many -t build lint test` pass.

## Decided wording (control plane, 14 November 2026)

This is wording and needs no further question. What each command-line form says to do:

- An unknown flag: remove it, or check its spelling.
- A flag that the target does not take: remove it.
- Positional words: remove them. Where the target has a way to pass arguments on, name it: for `run`, after `--` or with `--args`. For `test`, say that arguments for the test binary go in the option that the plugin has for them, if one exists, and otherwise only to remove them.

Note from the triage: as `optionTargets` in `nx-rust/src/executors/command.ts` stands (14 November 2026), only `run` takes `args`, and `test` has no option for arguments of the test binary. So the `test` line says only to remove the words, unless such an option exists by the time this is taken up. The first task item ("Decide what each of the three forms suggests, with the maintainer") is settled by this note; recording it in `DES-UNKNOWN-OPTIONS` and the user guide remains.

## Summary of Changes

- `ignoredOptionLine` (`nx-rust/src/executors/task-options.ts`) ends each command-line form with what to do, in the control plane's decided wording: an unknown option "Remove it, or check its spelling.", an option that the target does not take "Remove it.", positional words "Remove them.". `optionTargets` still gives `args` to `run` only and `test` has no option for arguments of the test binary, so only `run` names the ways to pass arguments on: its line for positional words says "Remove them, or pass them to the binary after `--` or with `--args`.", and, by the same rule, its line for an unknown option says "Remove it or check its spelling, or pass it to the binary after `--` or with `--args`." (the decided text named the `run` ways for words only).
- Recorded in `DES-UNKNOWN-OPTIONS` (paragraph "Source"), in the user guide (`nx-rust/docs/targets.mara.md`, the three quoted lines and the `run` note) and in `VER-UNKNOWN-OPTIONS` (`nx run <crate>:run serve`).
- Tests: the helpers `fromCommandLine`, `wordsFromCommandLine` and `notTakenFromCommandLine` in `unknown-options.spec.ts` assert the sentences; `run-arguments.spec.ts` asserts the `run` lines for `--coverage` and for the word `serve`; the end-to-end suite's three quoted lines are updated.
- Checks run: `pnpm nx run-many -t build lint test` (1121 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate`, `mara project validate` (valid, complete evaluation), `zban check`.
