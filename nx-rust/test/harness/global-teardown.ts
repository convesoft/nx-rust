import { endTestRun } from "./test-run";

/** Jest's global teardown for the unit tests. */
export default (): void => endTestRun();
