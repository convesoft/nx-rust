/**
 * This script stops the local registry for e2e testing purposes, and ends the
 * test run that the global setup started.
 * It is meant to be called in jest's globalTeardown.
 */

import { endTestRun } from "../../nx-rust/test/harness/test-run";

export default async () => {
  try {
    if (global.stopLocalRegistry) {
      await global.stopLocalRegistry();
    }
  } finally {
    endTestRun();
  }
};
