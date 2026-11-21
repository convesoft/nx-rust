/**
 * This script starts a local registry for e2e testing purposes, and then the
 * test run whose folder the commands of the tests share.
 * It is meant to be called in jest's globalSetup.
 */

import { workspaceRoot } from "@nx/devkit";
import { join } from "path";
import { releasePublish, releaseVersion } from "nx/release";
import { startTestRun } from "../../nx-rust/test/harness/test-run";
import { pluginVersionVariable, startLocalRegistry } from "./local-registry";

export default async () => {
  // local registry target to run
  const localRegistryTarget = "@convesoft/nx-rust-source:local-registry";
  // storage folder for the local registry
  const storage = "./tmp/local-registry/storage";

  // Each run publishes the plugin under a version of its own, which the
  // tests install by that exact version. A cache that still describes the
  // package of an earlier run, in pnpm's metadata or in its store, knows no
  // package of this version, so pnpm cannot install an older build from it.
  // That is why pnpm's cache can outlive a run: it keeps the metadata of the
  // packages from npmjs.org, such as nx, which the next run's installs then
  // do not fetch again. It is this checkout's own, so that the registries of
  // other checkouts, which can have run on the same port, add nothing to it.
  const version = `0.0.0-e2e.${Date.now()}-${process.pid}`;
  process.env[pluginVersionVariable] = version;
  process.env.pnpm_config_cache_dir = join(workspaceRoot, "tmp", "local-registry", "pnpm-cache");

  const stopLocalRegistry = await startLocalRegistry(localRegistryTarget, storage);
  global.stopLocalRegistry = stopLocalRegistry;

  try {
    await releaseVersion({
      specifier: version,
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
  // Last, so that a failed setup leaves no folder behind.
  startTestRun();
};
