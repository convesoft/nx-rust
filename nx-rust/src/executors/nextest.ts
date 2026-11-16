import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CrateOutcome,
  describeList,
  failEvery,
  type OutputCrate,
  type OutputScope,
  outsideMembers,
  plainLine,
} from "./cargo-output";
import { attributeText, failStopped, notCompiled, splitLines } from "./test-steps";

/**
 * How `cargo nextest run` ended, as the reading of its step trusts it
 * (`DES-TEST-RUN`, step 4): with 0, which nextest gives only where every
 * test that the run was to run finished and passed; with 100, which it
 * gives where a test failed and where the run ended before every test had
 * run, as on a global timeout, a signal or an interrupt; with 101, where
 * the build of the test binaries failed; with 105, where a setup script
 * failed; or otherwise, as by a signal, with another status or without
 * starting at all (`EVD-NEXTEST-RUNNER-STEPS`).
 */
export type NextestEnd =
  | { kind: "succeeded" }
  | { kind: "tests-failed" }
  | { kind: "build-failed" }
  | { kind: "setup-failed" }
  | { kind: "unexplained"; reason: string };

/** The status with which nextest ends where a test failed or the run ended early. */
export const testRunFailedStatus = 100;
/** The status with which nextest ends where the build of the test binaries failed. */
export const buildFailedStatus = 101;
/** The status with which nextest ends where a setup script failed. */
export const setupScriptFailedStatus = 105;

// What other statuses of nextest mean, for messages.
const otherStatuses: Readonly<Record<number, string>> = {
  4: "which nextest gives where no test is to run",
  92: "which nextest gives where its version does not meet the repository's nextest-version requirement",
  96: "which nextest gives where it cannot set up the run, as for a configuration that it cannot read",
  104: "which nextest gives where it cannot list the tests of a test binary, as where the binary cannot be loaded",
};

/** How a nextest step ended ({@link NextestEnd}), from its exit status and signal, or why it did not start. */
export function nextestEnd(
  code: number | null,
  signal: string | null,
  failure?: string,
): NextestEnd {
  if (failure !== undefined) {
    return { kind: "unexplained", reason: failure };
  }
  if (signal !== null) {
    return { kind: "unexplained", reason: `cargo nextest run was stopped by ${signal}` };
  }
  if (code === 0) {
    return { kind: "succeeded" };
  }
  if (code === testRunFailedStatus) {
    return { kind: "tests-failed" };
  }
  if (code === buildFailedStatus) {
    return { kind: "build-failed" };
  }
  if (code === setupScriptFailedStatus) {
    return { kind: "setup-failed" };
  }
  return {
    kind: "unexplained",
    reason: `cargo nextest run exited with status ${code}, ${otherStatuses[code ?? -1] ?? `which is none of success, a failed test or a run that ended early (${testRunFailedStatus}), a failed build (${buildFailedStatus}) and a failed setup script (${setupScriptFailedStatus})`}`,
  };
}

/** The plugin's tool configuration for one nextest step, in a folder of its own. */
export interface NextestToolConfiguration {
  /** The folder, which {@link removeToolConfiguration} removes after the step. */
  folder: string;
  /** The configuration file, which nextest takes as `--tool-config-file nx-rust:<file>`. */
  file: string;
  /** The JUnit report that the file asks nextest to write. */
  report: string;
}

/**
 * Writes the plugin's tool configuration for one nextest step into a new
 * folder under the system's temporary folder (`DES-TEST-RUN`, "nextest's
 * configuration"): it sets only `junit.path` of the `default` profile, to an
 * absolute path in that folder, which every profile inherits unless it sets
 * its own. nextest gives the repository's configuration precedence over a
 * tool configuration, so that the file adds the report and changes no test
 * that runs (`EVD-TEST-STREAM-AND-NEXTEST`). No other task's files are
 * written: the folder is the step's own.
 */
// @mara implements DES-TEST-RUN
export function writeToolConfiguration(): NextestToolConfiguration {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-nextest-"));
  const file = join(folder, "nextest.toml");
  const report = join(folder, "junit.xml");
  writeFileSync(
    file,
    [
      "# Written by @convesoft/nx-rust for one cargo nextest run, which reads its results from this report.",
      "[profile.default.junit]",
      `path = ${JSON.stringify(report)}`,
      "",
    ].join("\n"),
  );
  return { folder, file, report };
}

/** Removes the folder of a tool configuration and the report in it. */
export function removeToolConfiguration(configuration: NextestToolConfiguration): void {
  rmSync(configuration.folder, { recursive: true, force: true });
}

/** One test of nextest's JUnit report. */
export interface JunitCase {
  /** The test binary's ID, such as `a`, `a::it` or `a::bin/a`: the name of its suite. */
  binary: string;
  /** The test's name. */
  name: string;
  /** Whether the test failed: a `failure` or `error` element, not a flaky try that passed in the end. */
  failed: boolean;
  /**
   * Whether the test did not run: a `skipped` element, which nextest writes
   * for a test that a filter left out where the configuration's
   * `junit.report-skipped` asks for it.
   */
  skipped: boolean;
}

/**
 * What the plugin read of nextest's JUnit report: its tests, or that the
 * file is missing, or why it cannot be read.
 */
export type JunitReport =
  | { cases: JunitCase[] }
  | { missing: string }
  | { unreadable: string; file: string };

/** Reads nextest's JUnit report at `file` ({@link JunitReport}). */
export function readJunitReport(file: string): JunitReport {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { missing: file };
    }
    return { unreadable: error instanceof Error ? error.message : String(error), file };
  }
  const cases = parseJunit(text);
  return typeof cases === "string" ? { unreadable: cases, file } : { cases };
}

/**
 * The tests of a JUnit report as nextest writes it: `testsuites`, one
 * `testsuite` per test binary named by its binary ID, and in it one
 * `testcase` per test that ran, which failed where it has a `failure` or
 * `error` element; `flakyFailure` and `rerunFailure` record tries.
 *
 * The reading checks the nesting of every element and fails on anything it
 * does not understand, so that a report cut short or of another shape is
 * not read as one without failures. Text, where a test's output goes, holds
 * no markup: XML escapes it.
 *
 * @returns The tests, or why the report cannot be read.
 */
export function parseJunit(text: string): JunitCase[] | string {
  const cases: JunitCase[] = [];
  const stack: { name: string; attributes: Record<string, string> }[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  let current: JunitCase | undefined;
  let suites = 0;
  let at = text.indexOf("<");
  while (at !== -1) {
    const skip = (
      [
        ["<?", "?>"],
        ["<!--", "-->"],
        ["<![CDATA[", "]]>"],
        ["<!", ">"],
      ] as const
    ).find(([open]) => text.startsWith(open, at));
    if (skip !== undefined) {
      const end = text.indexOf(skip[1], at + skip[0].length);
      if (end === -1) {
        return "it ends inside a declaration, a comment or a CDATA section";
      }
      at = text.indexOf("<", end + skip[1].length);
      continue;
    }
    tag.lastIndex = at;
    const match = tag.exec(text);
    if (match === null) {
      return `it holds markup that is no element at character ${at}`;
    }
    const [, closing, name, attributeText, selfClosing] = match;
    if (closing === "/") {
      const open = stack.pop();
      if (open === undefined || open.name !== name) {
        return `the element ${name} closes where ${open === undefined ? "none" : open.name} is open`;
      }
      if (name === "testcase") {
        current = undefined;
      }
    } else {
      const attributes = parseAttributes(attributeText);
      const parent = stack.at(-1)?.name;
      if (name === "testsuites" && parent !== undefined) {
        return "testsuites is not the root element";
      }
      if (name === "testsuite") {
        if (parent !== "testsuites" && parent !== undefined) {
          return `a testsuite lies inside ${parent}`;
        }
        if (attributes.name === undefined) {
          return "a testsuite has no name";
        }
        suites += 1;
      }
      if (name === "testcase") {
        if (parent !== "testsuite") {
          return `a testcase lies inside ${parent ?? "no testsuite"}`;
        }
        const suite = stack.at(-1)?.attributes.name as string;
        if (attributes.name === undefined) {
          return `a testcase of ${suite} has no name`;
        }
        current = { binary: suite, name: attributes.name, failed: false, skipped: false };
        cases.push(current);
      }
      if ((name === "failure" || name === "error") && parent === "testcase") {
        if (current === undefined) {
          return "a failure lies outside a testcase";
        }
        current.failed = true;
      }
      if (name === "skipped" && parent === "testcase" && current !== undefined) {
        current.skipped = true;
      }
      if (selfClosing !== "/") {
        stack.push({ name, attributes });
      } else if (name === "testcase") {
        current = undefined;
      }
    }
    at = text.indexOf("<", tag.lastIndex);
  }
  if (stack.length > 0) {
    return `it ends while ${stack.map((entry) => entry.name).join(" > ")} is open`;
  }
  if (suites === 0 && cases.length === 0 && !/<testsuites\b/.test(text)) {
    return "it holds no testsuites element";
  }
  return cases;
}

// The attributes of a start tag, with the five entities and character
// references decoded.
function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10),
        );
    }
  });
}

/**
 * The package of a test binary: the part of its binary ID before the first
 * `::`, which was the package name of every binary in nextest's reports
 * (`EVD-CARGO-AFFECTED-REPORT`, "Tests to crates").
 */
export function binaryPackage(binary: string): string {
  const at = binary.indexOf("::");
  return at === -1 ? binary : binary.slice(0, at);
}

/**
 * What a suite of nextest's JUnit report stands for, by its name
 * (`EVD-NEXTEST-RUNNER-STEPS`): a test binary, named by its binary ID; a
 * setup script, `@setup-script:<id>`; either with `@stress-<n>` after it in a
 * stress run; or something else, which the plugin does not know.
 */
export type SuiteKind =
  | { kind: "binary"; binary: string; package: string }
  | { kind: "setup-script"; script: string }
  | { kind: "unknown"; name: string };

/** The kind of the suite of nextest's JUnit report named `name` ({@link SuiteKind}). */
export function suiteKind(name: string): SuiteKind {
  const bare = name.replace(/@stress-\d+$/, "");
  const script = /^@setup-script:(.+)$/.exec(bare);
  if (script !== null) {
    return { kind: "setup-script", script: script[1] };
  }
  if (bare === "" || bare.includes("@")) {
    return { kind: "unknown", name };
  }
  return { kind: "binary", binary: bare, package: binaryPackage(bare) };
}

/** A test that nextest's list says a run with the same arguments is to run. */
export interface ListedTest {
  /** The package of its binary, as the list names it. */
  package: string;
  /** The binary ID. */
  binary: string;
  /** The test's name. */
  name: string;
}

/** The tests that a nextest run was to run, or why the plugin cannot tell. */
export type ListedTests = { tests: ListedTest[] } | { unreadable: string };

/**
 * The tests whose `filter-match` is `matches` in the output of `cargo
 * nextest list --message-format json`, whose format nextest keeps stable:
 * `rust-suites` by binary ID, each with its `package-name` and its
 * `testcases`, each of which matches the run's filters or not, with the
 * reason (`EVD-NEXTEST-RUNNER-STEPS`). An output of another shape cannot be
 * read.
 */
export function parseNextestList(stdout: string): ListedTests {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    return {
      unreadable: `its output is no JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const suites = (data as { "rust-suites"?: unknown } | null)?.["rust-suites"];
  if (typeof suites !== "object" || suites === null) {
    return { unreadable: "its output holds no rust-suites" };
  }
  const tests: ListedTest[] = [];
  for (const [binary, entry] of Object.entries(suites)) {
    const suite = entry as { "package-name"?: unknown; testcases?: unknown } | null;
    const pkg = suite?.["package-name"];
    const testcases = suite?.testcases;
    if (typeof pkg !== "string" || typeof testcases !== "object" || testcases === null) {
      return { unreadable: `its suite ${binary} has no package-name or no testcases` };
    }
    for (const [name, test] of Object.entries(testcases)) {
      const status = (test as { "filter-match"?: { status?: unknown } } | null)?.["filter-match"]
        ?.status;
      if (status !== "matches" && status !== "mismatch") {
        return { unreadable: `the test ${binary} ${name} has no filter-match that it knows` };
      }
      if (status === "matches") {
        tests.push({ package: pkg, binary, name });
      }
    }
  }
  return { tests };
}

/**
 * Reads the step `cargo nextest run` of a group of several crates or of the
 * whole workspace (`DES-TEST-RUN`, steps 3 and 4, "nextest's
 * configuration"), from nextest's exit status, its JUnit report and, where
 * it exits with 100, its list of the tests that the run was to run, never
 * from a line that nextest or cargo writes for people:
 *
 * - with 0, which nextest gives only where every test that the run was to
 *   run finished and passed, every task passes; a report that holds a failed
 *   test then fails every task, since it contradicts the status;
 * - with 100, which nextest gives where a test failed and where it ended the
 *   run early, as on a global timeout, a signal or an interrupt, a task
 *   passes only where the report holds no failed test of its package and
 *   every test of its package that the list names ran and passed; every task
 *   fails where the report is missing, as where the repository's profile
 *   sets its own `junit.path`, or cannot be read, and every task without a
 *   failed test of its own where the list cannot be read;
 * - with 101, the build of the test binaries failed, which stops the step
 *   before any test runs, and every task fails with the crates that did not
 *   compile (`DES-BATCH`, "Test runs");
 * - with 105, a setup script failed, and every task fails with the scripts
 *   that the report names;
 * - with any other status, by a signal or without a start, every task fails.
 *
 * A report that holds a failed setup script, a suite that is neither a test
 * binary nor a setup script ({@link suiteKind}) or a test of a package
 * outside the group fails every task, whatever the status; a setup script
 * that passed decides nothing.
 *
 * Each task's output holds the compiler's messages about its crate, the
 * lines of nextest that name one of its test binaries with the output under
 * them, and every line that names no crate of the group, such as nextest's
 * `Starting` line, with the tests that the configuration skipped, and its
 * summary; and the task's message gives the number of its crate's tests in
 * the report, so that a crate whose tests the configuration skips shows 0.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-DIAGNOSTICS
// @mara implements REQ-TEST-RUNNER
export function readNextestStep(
  output: string,
  end: NextestEnd,
  crates: readonly OutputCrate[],
  scope: OutputScope | undefined,
  report: JunitReport,
  listed?: ListedTests,
): CrateOutcome[] {
  const lines = splitLines(output);
  const texts = attributeNextest(lines, crates, scope).map((part) => part.join("\n"));
  if (end.kind === "unexplained") {
    return failEvery(crates, texts, end.reason);
  }
  if (end.kind === "build-failed") {
    return failStopped(
      crates,
      texts,
      notCompiled(lines),
      outsideMembers(crates, scope).names,
      "cargo nextest run",
    );
  }
  const names = new Set(crates.map((crate) => crate.name));
  const kinds = "cases" in report ? report.cases.map((test) => suiteKind(test.binary)) : [];
  const unknown = [
    ...new Set(kinds.flatMap((kind) => (kind.kind === "unknown" ? [kind.name] : []))),
  ];
  if (unknown.length > 0) {
    return failEvery(
      crates,
      texts,
      `nextest's JUnit report holds the ${unknown.length === 1 ? "suite" : "suites"} ${describeList(unknown.map((name) => `\`${name}\``))}, which @convesoft/nx-rust does not recognise as a test binary or a setup script`,
    );
  }
  const strangers = [
    ...new Set(
      kinds.flatMap((kind) =>
        kind.kind === "binary" && !names.has(kind.package) ? [kind.package] : [],
      ),
    ),
  ];
  if (strangers.length > 0) {
    return failEvery(
      crates,
      texts,
      `nextest's JUnit report holds tests of ${describeList(strangers.map((name) => `\`${name}\``))}, which ${strangers.length === 1 ? "is" : "are"} no crate of this run, while the command let only the tests of its crates run`,
    );
  }
  const failedScripts =
    "cases" in report
      ? [
          ...new Set(
            report.cases.flatMap((test, index) => {
              const kind = kinds[index];
              return kind.kind === "setup-script" && test.failed ? [kind.script] : [];
            }),
          ),
        ]
      : [];
  if (failedScripts.length > 0 || end.kind === "setup-failed") {
    return crates.map((crate, index) => ({
      passed: false,
      output: texts[index],
      message:
        failedScripts.length > 0
          ? `${crate.task}: the setup ${failedScripts.length === 1 ? "script" : "scripts"} ${describeList(failedScripts.map((script) => `\`${script}\``))} of the repository's nextest configuration failed, so nextest did not run every test of this run, and every task of the group fails. nextest's output above shows the script's.`
          : `${crate.task}: nextest exited with status ${setupScriptFailedStatus}, which it gives where a setup script failed, so it did not run every test of this run, and every task of the group fails.`,
    }));
  }
  // The report's tests of test binaries, each with the package of its binary.
  const tests =
    "cases" in report
      ? report.cases.flatMap((test, index) => {
          const kind = kinds[index];
          return kind.kind === "binary"
            ? [{ ...test, binary: kind.binary, package: kind.package }]
            : [];
        })
      : [];
  if (end.kind === "succeeded") {
    if (tests.some((test) => test.failed)) {
      return failEvery(
        crates,
        texts,
        "cargo nextest run exited with status 0, while its JUnit report holds a failed test",
      );
    }
    return crates.map((crate, index) => ({
      passed: true,
      output: texts[index],
      message: countLine(crate, report, tests),
    }));
  }
  // nextest exited with 100: a test failed, or the run ended early.
  if ("missing" in report) {
    return crates.map((crate, index) => ({
      passed: false,
      output: texts[index],
      message: `${crate.task}: nextest exited with status ${testRunFailedStatus}, which it gives where a test failed or the run ended early, and wrote no JUnit report to ${report.missing}, the file that @convesoft/nx-rust's tool configuration names. nextest writes the report elsewhere where the repository's nextest profile sets its own junit.path, which takes precedence over a tool configuration. Without the report, @convesoft/nx-rust cannot tell which crate's test failed, so every task of this cargo nextest run fails. Remove junit.path from the profile that the run uses in .config/nextest.toml (the default profile, or the one that NEXTEST_PROFILE chooses), or run the task with --batch=false, where its crate's tests run alone.`,
    }));
  }
  if ("unreadable" in report) {
    return failEvery(
      crates,
      texts,
      `nextest exited with status ${testRunFailedStatus}, which it gives where a test failed or the run ended early, and its JUnit report ${report.file} cannot be read: ${report.unreadable}`,
    );
  }
  return crates.map((crate, index) => {
    const own = tests.filter((test) => test.package === crate.name);
    const failed = own.filter((test) => test.failed);
    if (failed.length > 0) {
      return {
        passed: false,
        output: texts[index],
        message: [
          countLine(crate, report, tests),
          `${crate.task}: ${failed.length === 1 ? "a test" : `${failed.length} tests`} of ${crate.name} failed: ${failed.map((test) => `${test.binary} ${test.name}`).join(", ")}.`,
        ].join("\n"),
      };
    }
    if (listed === undefined || "unreadable" in listed) {
      return {
        passed: false,
        output: texts[index],
        message: `${crate.task}: nextest exited with status ${testRunFailedStatus}, which it gives where a test failed or the run ended early, and @convesoft/nx-rust could not learn from cargo nextest list which tests of ${crate.name} the run was to run${listed === undefined || !("unreadable" in listed) ? "" : `: ${listed.unreadable}`}. It cannot show that every test of ${crate.name} ran, so the task fails.`,
      };
    }
    const ran = new Set(
      own.filter((test) => !test.skipped).map((test) => `${test.binary}\0${test.name}`),
    );
    const expected = listed.tests.filter((test) => test.package === crate.name);
    const missing = expected.filter((test) => !ran.has(`${test.binary}\0${test.name}`));
    if (missing.length === 0) {
      return { passed: true, output: texts[index], message: countLine(crate, report, tests) };
    }
    return {
      passed: false,
      output: texts[index],
      message: [
        countLine(crate, report, tests),
        `${crate.task}: the run was not complete: nextest did not run ${missing.length} of the ${expected.length} ${expected.length === 1 ? "test" : "tests"} of ${crate.name} that it was to run, such as ${missing
          .slice(0, 3)
          .map((test) => `${test.binary} ${test.name}`)
          .join(
            ", ",
          )}. nextest ends a run early on a global timeout, a signal or an interrupt, and its output above says why. Tests that did not run cannot show that ${crate.name} passes, so the task fails.`,
      ].join("\n"),
    };
  });
}

// The line that gives the number of the crate's tests in the report that ran.
function countLine(
  crate: OutputCrate,
  report: JunitReport,
  tests: readonly (JunitCase & { package: string })[],
): string {
  if (!("cases" in report)) {
    return `${crate.task}: nextest wrote no JUnit report to the file that @convesoft/nx-rust's tool configuration names, as where the repository's nextest profile sets its own junit.path, so the number of tests that ran for ${crate.name} is not shown. nextest exited with status 0: every test that the run was to run passed.`;
  }
  const count = tests.filter((test) => test.package === crate.name && !test.skipped).length;
  return count === 0
    ? `${crate.task}: nextest ran no test of ${crate.name}: the crate has none, or the repository's nextest configuration skips them.`
    : `${crate.task}: nextest ran ${count} ${count === 1 ? "test" : "tests"} of ${crate.name}, as its JUnit report shows.`;
}

// A line of nextest's that names a test: a status in capitals, such as
// `PASS`, `FAIL`, `TRY 2 FAIL` or `SLOW`, a time in brackets, a counter on
// newer versions, the binary ID and the test's name.
const statusLine =
  /^\s*[A-Z][A-Z0-9]*(?: [A-Z0-9]+)*\s+\[[^\]]*\]\s+(?:\(\s*\d+\/\d+\)\s+)?(\S+)\s+\S/;

// A line of nextest's about the whole run, which ends the block of a test.
const runHeader = /^\s*(?:Starting|Summary|Cancell?ing|Nextest run|Interrupted|Aborting)\b/;

/**
 * The output of a nextest step, per crate: the lines before nextest's
 * `Starting` line as compiler output ({@link attributeText}); after it, each
 * line that names a test binary of a crate of the group, with the indented
 * lines under it, such as the test's output, to that crate, and every other
 * line to every crate.
 */
function attributeNextest(
  lines: readonly string[],
  crates: readonly OutputCrate[],
  scope: OutputScope | undefined,
): string[][] {
  const start = lines.findIndex((line) => /^\s*Starting \d+ tests? across /.test(plainLine(line)));
  const parts = attributeText(start === -1 ? lines : lines.slice(0, start), crates, scope);
  if (start === -1) {
    return parts;
  }
  const every = crates.map((_, index) => index);
  let target = every;
  for (const line of lines.slice(start)) {
    const plain = plainLine(line);
    const status = statusLine.exec(plain);
    if (status !== null) {
      const index = crates.findIndex((crate) => crate.name === binaryPackage(status[1]));
      target = index === -1 ? every : [index];
    } else if ((plain.trim() !== "" && !/^\s/.test(plain)) || runHeader.test(plain)) {
      target = every;
    }
    for (const index of target) {
      parts[index].push(line);
    }
  }
  return parts;
}
