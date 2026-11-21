---
title: Read a build's resolved outputs in one place for the same-folder refusal and for the files a test batch keeps
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:45:16Z
---

Goal: `sharedBuildFolders` and the keeping of files for a test batch judge a `build` task's resolved outputs with one helper, so that the two cannot differ (`DES-BATCH`, "Files that a batch stores" and "Files that a test batch puts back").

Context: finding 1 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. `nx-rust/src/executors/stage.ts` (`sharedBuildFolders`, `sharedOutput`, about lines 542-605) and `nx-rust/src/executors/kept-files.ts` (`storingBuilds`, `repositoryPath`, `stores`, `isLiteral`, about lines 337-422) both read `context.taskGraph.tasks[id].outputs` of the plugin's `build` tasks. `kept-files.ts` was rebuilt in nxr-5hzxra and handles cases that `sharedBuildFolders` does not:

- an exclusion (`!…`) is compared as a path, so two builds of one crate into different folders that share an exclusion are refused, with a folder that starts with `!` in the message;
- a build with `cache: false` is still refused, although Nx stores nothing for it;
- an output with a trailing slash, the repository root (`.`), an absolute path inside the repository and a glob are not recognised as naming the other build's file, so a real collision is missed.

Each needs two `build` tasks of one crate in one command with outputs that a user declared, which is why this waits in the backlog.

- [ ] Move the reading of a task's outputs (cached plugin builds, repository-relative paths, exclusions, Nx's own matcher for globs) into one module that both callers use
- [ ] Decide with `DES-BATCH` whether an uncached build takes part in the refusal, and write the answer into the item
- [ ] Unit cases for each form above, for both callers

Done when: both callers use the helper, the cases pass, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
