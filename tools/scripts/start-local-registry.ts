/**
 * This script starts a local registry for e2e testing purposes.
 * It is meant to be called in jest's globalSetup.
 */

/// <reference path="registry.d.ts" />

import { workspaceRoot } from "@nx/devkit";
import { rmSync } from "fs";
import { join } from "path";
import { releasePublish, releaseVersion } from "nx/release";
import { startLocalRegistry } from "./local-registry";

export default async () => {
  // local registry target to run
  const localRegistryTarget = "@convesoft/nx-rust-source:local-registry";
  // storage folder for the local registry
  const storage = "./tmp/local-registry/storage";

  // Every run publishes the plugin under the same version, and pnpm's own
  // metadata cache, shared by all checkouts of a user, may still describe
  // the package of an earlier run. Installing from it would test that
  // package. pnpm gets a cache of its own instead, emptied together with the
  // registry's storage, so that it knows only what this run published.
  const pnpmCache = join(workspaceRoot, "tmp", "local-registry", "pnpm-cache");
  rmSync(pnpmCache, { recursive: true, force: true });
  process.env.pnpm_config_cache_dir = pnpmCache;

  const stopLocalRegistry = await startLocalRegistry(localRegistryTarget, storage);
  global.stopLocalRegistry = stopLocalRegistry;

  try {
    await releaseVersion({
      specifier: "0.0.0-e2e",
      stageChanges: false,
      gitCommit: false,
      gitTag: false,
      firstRelease: true,
      versionActionsOptionsOverrides: {
        skipLockFileUpdate: true,
      },
    });
    await releasePublish({
      tag: "e2e",
      firstRelease: true,
    });
  } catch (error) {
    // Jest runs no global teardown when the global setup fails. A registry
    // left running would make the next run in this checkout fail to start one.
    await stopLocalRegistry();
    throw error;
  }
};
