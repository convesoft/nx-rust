import { compilePlugin } from "./compiled-plugin";
import { startTestRun } from "./test-run";

/** Jest's global setup for the unit tests. */
export default (): void => {
  startTestRun();
  compilePlugin();
};
