const { availableParallelism } = require("node:os");

/**
 * The most test files that run at once. A Jest worker holds about 250 MB,
 * and the Nx and cargo processes that its tests start hold more besides, so
 * that Jest's default of one worker per core but one exhausts the memory of
 * a machine with many cores. Where there are fewer cores, Jest's default
 * applies.
 */
const maxWorkers = 3;

module.exports = {
  displayName: "@convesoft/nx-rust",
  preset: "../jest.preset.js",
  testEnvironment: "node",
  maxWorkers: Math.max(1, Math.min(maxWorkers, availableParallelism() - 1)),
  globalSetup: "<rootDir>/test/harness/global-setup.ts",
  globalTeardown: "<rootDir>/test/harness/global-teardown.ts",
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.spec.json" }],
  },
  moduleFileExtensions: ["ts", "js", "html"],
  coverageDirectory: "../coverage/nx-rust",
  passWithNoTests: true,
};
