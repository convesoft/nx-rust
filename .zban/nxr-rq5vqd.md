---
title: The end-to-end tests can install a stale plugin from pnpm's metadata cache
status: todo
type: bug
tags:
  - tests
discovered_from: nxr-7n0nqf
created_at: 2026-11-13T10:41:08Z
---

Goal: `pnpm nx e2e nx-rust-e2e` always tests the plugin that its global setup has just built and published, on a developer machine as in CI.

Found while working on nxr-7n0nqf on 13 November 2026, with pnpm 12.18.0 on Linux. Every run publishes the plugin to the local registry (`http://localhost:4873`) under the same version, `0.0.0-e2e` (`tools/scripts/start-local-registry.ts`). pnpm keeps registry metadata in a cache shared by all checkouts of a user (`~/.cache/pnpm/v12/metadata/http%3A+localhost+4873/@convesoft/nx-rust.jsonl`). When that cache holds the metadata of an earlier publish, `pnpm add -D @convesoft/nx-rust@e2e` in `nx-rust-e2e/src/nx-rust.spec.ts` resolves the old integrity and reuses the old package from the store ("resolved 1, reused 3, downloaded 0"), so the tests run against an earlier build. The cached integrity differed from the one in `tmp/local-registry/storage/@convesoft/nx-rust/package.json`.

A test that expects the new behaviour then fails, and a test that should fail can pass. CI starts with empty caches and is not affected. Running the suite with `npm_config_cache_dir` and `pnpm_config_cache_dir` pointing at an empty folder made pnpm download the fresh package, and the suite passed.

- [ ] Make the test project's install ignore cached metadata of earlier publishes, for example with a cache folder of its own under `tmp/` or a version that is unique per run
- [ ] Show that a run after a publish of different content installs the new package
