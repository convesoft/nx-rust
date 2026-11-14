---
title: Decide whether nx release version rewrites registry requirements that a [patch] redirects to a bumped crate
status: done
type: task
parent: nxr-6q2chq
discovered_from: nxr-1ckcy8
created_at: 2026-11-14T18:46:56Z
closed_at: 2026-11-14T19:25:13Z
---

Needs the maintainer's decision; nothing is to be implemented before it.

A member can ask a registry for a crate, `base = "0.1"`, that a `[patch]` entry of its workspace redirects to a member by path. When `nx release version` bumps that member to a version that the requirement leaves, cargo drops the redirection without an error and takes the registry's crate instead (`EVD-CARGO-PATCH-AFTER-BUMP`). `DES-RELEASE` (paragraph **Requirements**) now stops such a run before anything is written, with a message that says to give the dependency a path or to change the requirement. The experiment also showed that rewriting the requirement to the new version keeps the redirection working, even where the registry lacks that version.

- [x] The maintainer chooses: keep failing such a run; or rewrite the requirement by the rules of any other requirement, and then whether the member that holds it becomes a dependent of the bumped crate (its published manifest would name the new version of the registry's crate)
- [x] `DES-RELEASE` is rewritten to the answer, and a follow-up issue is filed if it asks for code

## Summary of Changes

The maintainer chose on 14 November 2026, word for word: "Keep stopping the run (Recommended)"; not taken: rewriting the requirement like any other. `DES-RELEASE` (**Requirements**) records the decision; the run already stopped, and no code was needed beyond the review's fix in the same branch, which made the check recognise every key of `[patch.<source>]` that cargo applies (`crates-io`, a registry's name from `[registries]` or `CARGO_REGISTRIES_<NAME>_INDEX` or the dependency's entry, a `sparse+` index URL, a git URL; `EVD-CARGO-PATCH-AFTER-BUMP`). Checks: listed in the summary of nxr-1ckcy8.
