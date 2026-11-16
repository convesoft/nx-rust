import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  type CommandEnd,
  type CrateOutcome,
  describeList,
  failEvery,
  type OutputCrate,
  type OutputScope,
  outsideMembers,
  plainLine,
  startsBlock,
} from "./cargo-output";
import type { RecordEntry } from "./test-runner";

/**
 * What the selecting runner recorded in the test binaries' step
 * (`DES-TEST-RUN`, "The selecting runner"): one record per start, or why
 * the record folder could not be read.
 */
export type RunnerRecords = { records: RunnerRecord[] } | { unreadable: string };

/** One start of the selecting runner, from its file in the record folder. */
export interface RunnerRecord {
  /** The file's name, for messages. */
  file: string;
  /** What the runner recorded first: the package and the program. */
  start?: { package: string; program: string };
  /** The entries after the start, in order: a skip, an error or the end. */
  after: RecordEntry[];
  /** A line of the file that is no entry. */
  malformed?: string;
}

/** The selecting runner's command and the list of packages, for messages. */
export interface RunnerSetup {
  /** The command that cargo starts for each test executable, as words. */
  command: readonly string[];
  /** The value of `NX_RUST_TEST_PACKAGES`. */
  packages: string;
}

/**
 * Splits text output into blocks that each start with a line of
 * {@link startsBlock}, the lines before the first being a block of their own,
 * and gives each to the crates it concerns: a block whose first line or a
 * location line (` --> path:line:col`) names a crate of the group goes to that
 * crate; one that concerns only a member outside the group is left out,
 * unless it is an error, which can explain a failure and goes to every
 * crate; every other block goes to every crate.
 */
export function attributeText(
  lines: readonly string[],
  crates: readonly OutputCrate[],
  scope: OutputScope | undefined,
): string[][] {
  const outside = outsideMembers(crates, scope);
  const parts = crates.map(() => [] as string[]);
  const blocks: string[][] = [];
  for (const line of lines) {
    if (blocks.length === 0 || startsBlock(line)) {
      blocks.push([line]);
    } else {
      blocks[blocks.length - 1].push(line);
    }
  }
  const folders = crates.map((crate) =>
    crate.package === undefined ? undefined : resolve(crate.package.manifest_path, ".."),
  );
  for (const block of blocks) {
    const [header] = block;
    const owner = blockOwner(block, crates, folders, scope);
    if (owner !== undefined) {
      parts[owner].push(...block);
      continue;
    }
    const location = block
      .map((line) => /^\s*-->\s+(.+?):\d+:\d+$/.exec(plainLine(line))?.[1])
      .find((path) => path !== undefined);
    const outsideOnly =
      outside.ownsLine(header) ||
      (location !== undefined && outside.atPath(location) !== undefined);
    if (outsideOnly && !plainLine(header).startsWith("error")) {
      continue;
    }
    for (const part of parts) {
      part.push(...block);
    }
  }
  return parts;
}

// The crate of the group that a block of text concerns alone, if any.
function blockOwner(
  block: readonly string[],
  crates: readonly OutputCrate[],
  folders: readonly (string | undefined)[],
  scope: OutputScope | undefined,
): number | undefined {
  const [header] = block;
  const status = /^\s*[A-Z][a-z]+ (\S+) v\S+ \(([^)]+)\)/.exec(plainLine(header));
  if (status !== null) {
    const index = crates.findIndex(
      (crate, at) => crate.name === status[1] && folders[at] === resolve(status[2]),
    );
    return index === -1 ? undefined : index;
  }
  const named =
    /^error: could not compile `([^`]+)`/.exec(plainLine(header)) ??
    /^warning: `([^`]+)` \(/.exec(plainLine(header)) ??
    /^error: failed to run custom build command for `(\S+) v/.exec(plainLine(header));
  if (named !== null) {
    const index = crates.findIndex((crate) => crate.name === named[1]);
    return index === -1 ? undefined : index;
  }
  const location = block
    .map((line) => /^\s*-->\s+(.+?):\d+:\d+$/.exec(plainLine(line))?.[1])
    .find((path) => path !== undefined);
  if (location === undefined) {
    return undefined;
  }
  const file = resolve(scope?.root ?? ".", location);
  // The deepest folder of a crate of the group that holds the file.
  let best: number | undefined;
  folders.forEach((folder, index) => {
    if (
      folder !== undefined &&
      (file.startsWith(`${folder}/`) || file === folder) &&
      (best === undefined || folder.length > (folders[best] as string).length)
    ) {
      best = index;
    }
  });
  if (best === undefined) {
    return undefined;
  }
  // A member nested in the crate's folder holds the file instead.
  const nested = (scope?.members ?? []).some((member) => {
    const folder = resolve(member.manifest_path, "..");
    return (
      folder.length > (folders[best as number] as string).length &&
      (file.startsWith(`${folder}/`) || file === folder)
    );
  });
  return nested ? undefined : best;
}

/** The crates that cargo's text says did not compile, each once, in order. */
export function notCompiled(lines: readonly string[]): string[] {
  return [
    ...new Set(
      lines.flatMap((line) => {
        const name =
          /^error: could not compile `([^`]+)`/.exec(plainLine(line))?.[1] ??
          /^error: failed to run custom build command for `(\S+) v/.exec(plainLine(line))?.[1];
        return name === undefined ? [] : [name];
      }),
    ),
  ];
}

// The crates that did not compile, as a message names them: each in
// backquotes, and those outside the group marked as such.
function describeNotCompiled(names: readonly string[], outsideNames: ReadonlySet<string>): string {
  return describeList(
    names.map((name) =>
      outsideNames.has(name)
        ? `\`${name}\`, which is outside the selection of this run (under workspace-build, cargo test compiles the tests and libraries of every crate of the workspace)`
        : `\`${name}\``,
    ),
  );
}

/**
 * Fails every crate because a test step stopped before any test ran, with a
 * message that names the crates that did not compile, `what` being the
 * command, and says which of them are outside the group (`DES-BATCH`, "Test
 * runs").
 */
export function failStopped(
  crates: readonly OutputCrate[],
  parts: readonly string[],
  names: readonly string[],
  outsideNames: ReadonlySet<string>,
  what: string,
): CrateOutcome[] {
  return crates.map((crate, index) => ({
    passed: false,
    output: parts[index] ?? "",
    message:
      names.length === 0
        ? `${crate.task}: ${what} failed before any test ran, and its output names no crate that did not compile, so it does not show that the tests of ${crate.name} passed.`
        : `${crate.task}: the tests of ${crate.name} were not run: ${what} stopped before running any test, because ${describeNotCompiled(names, outsideNames)} did not compile. The tests of every crate of this run's group were not run. Fix the crate that does not compile and run the tasks again.`,
  }));
}

/**
 * Reads the build step of `test` under `workspace-build`, `cargo test
 * --workspace --no-run` (`DES-TEST-RUN`, "Under `workspace-build`"): every
 * crate passes the step where cargo exits with status 0, and every crate
 * fails otherwise, since a compile error stops the step and no test can run;
 * the message names the crates that did not compile, says which of them are
 * outside the selection, and that the tests of the others were not run
 * (`DES-BATCH`, "Test runs"). Each crate's output holds the compiler's
 * messages about it and those that the output does not attribute to one
 * crate ({@link attributeText}).
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-BATCH
export function readTestsBuildStep(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  scope: OutputScope,
): CrateOutcome[] {
  const lines = splitLines(output);
  const parts = attributeText(
    lines.filter((line) => !/^\s+Executable /.test(plainLine(line))),
    crates,
    scope,
  );
  // Cargo names each test executable that it built: a crate's output keeps
  // the lines of the executables that its targets could have built.
  for (const line of lines) {
    const file = /^\s+Executable .*\(([^()]+)\)$/.exec(plainLine(line))?.[1];
    if (file === undefined) {
      continue;
    }
    const stem = basename(file)
      .replace(/\.exe$/, "")
      .replace(/-[0-9a-f]{16}$/, "");
    const owners = crates.flatMap((crate, index) =>
      (crate.package?.targets ?? []).some((target) => target.name.replace(/-/g, "_") === stem)
        ? [index]
        : [],
    );
    for (const index of owners) {
      parts[index].push(line);
    }
  }
  const texts = parts.map((part) => part.join("\n"));
  return testsBuildOutcomes(texts, lines, end, crates, scope);
}

// What the build step's end shows for each crate, with its output.
function testsBuildOutcomes(
  parts: readonly string[],
  lines: readonly string[],
  end: CommandEnd,
  crates: readonly OutputCrate[],
  scope: OutputScope,
): CrateOutcome[] {
  if (end.kind === "succeeded") {
    return crates.map((_, index) => ({ passed: true, output: parts[index] }));
  }
  if (end.kind === "unexplained") {
    return failEvery(crates, parts, end.reason);
  }
  return failStopped(
    crates,
    parts,
    notCompiled(lines),
    outsideMembers(crates, scope).names,
    "cargo test --no-run",
  );
}

/** One JSON message of cargo, as the test binaries' step reads it. */
interface StepMessage {
  reason?: string;
  package_id?: string;
  executable?: string | null;
  profile?: { test?: boolean };
  success?: unknown;
}

/**
 * Reads the test binaries' step under `workspace-build` (`DES-TEST-RUN`,
 * "Evidence for test binaries"), from cargo's JSON messages, the selecting
 * runner's record and cargo's exit status only, never from a line that cargo
 * writes for people or that a test writes.
 *
 * Every `compiler-artifact` message with `executable` and `profile.test`
 * anywhere in the output, where a line holds `{"reason":`, adds an expected
 * test executable of its `package_id`, so that a line that is not cargo's
 * can add an expectation and never remove one. Every crate fails where cargo
 * ended in a way that the reading cannot explain, where such a line is no
 * JSON message, where a `build-finished` message reports a failure or none
 * appears, where a test executable belongs to no member, where the record
 * folder cannot be read or holds an error entry or a malformed line, and
 * where cargo failed while no record explains it. Otherwise a crate passes
 * only where every expected executable of its package has exactly one
 * record, of that program by real path and of its package, ending with the
 * status 0, and no record of its package ends otherwise.
 *
 * Each crate's output holds the output after cargo's `Running` line for one
 * of its executables, which the JSON names, and the lines that the output
 * does not attribute to one crate; the `Running` lines of the executables of
 * other members, which the runner skipped, are left out.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-BATCH
// @mara implements DES-DIAGNOSTICS
export function readTestBinariesStep(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  scope: OutputScope,
  record: RunnerRecords,
  runner: RunnerSetup,
): CrateOutcome[] {
  const lines = splitLines(output);
  const messages: StepMessage[] = [];
  let malformed: string | undefined;
  for (const line of lines) {
    const at = line.indexOf('{"reason":');
    if (at === -1) {
      continue;
    }
    try {
      messages.push(JSON.parse(line.slice(at)) as StepMessage);
    } catch {
      malformed ??= line;
    }
  }
  const memberIds = new Set(scope.members.map((member) => member.id));
  const executables = messages.filter(
    (message) =>
      message.reason === "compiler-artifact" &&
      typeof message.executable === "string" &&
      message.executable !== "" &&
      message.profile?.test === true,
  ) as (StepMessage & { executable: string })[];

  const parts = attributeTestBinaries(lines, crates, scope, executables);
  const texts = parts.map((part) => part.join("\n"));
  if (end.kind === "unexplained") {
    return failEvery(crates, texts, end.reason);
  }
  if (malformed !== undefined) {
    return failEvery(
      crates,
      texts,
      `a line of the test binaries' step that holds a JSON message of cargo is cut short or malformed: ${JSON.stringify(malformed)}`,
    );
  }
  const finished = messages.filter((message) => message.reason === "build-finished");
  if (finished.some((message) => message.success !== true)) {
    return failStopped(
      crates,
      texts,
      notCompiled(lines),
      outsideMembers(crates, scope).names,
      "cargo test",
    );
  }
  if (finished.length === 0) {
    return failEvery(
      crates,
      texts,
      "cargo's JSON messages of the test binaries' step hold no build-finished, which cargo prints when the build has ended",
    );
  }
  const stranger = executables.find((message) => !memberIds.has(message.package_id ?? ""));
  if (stranger !== undefined) {
    return failEvery(
      crates,
      texts,
      `cargo named the test executable ${stranger.executable} of ${JSON.stringify(stranger.package_id ?? null)}, which is no member of the workspace, while cargo runs the tests of members only`,
    );
  }
  if ("unreadable" in record) {
    return failEvery(
      crates,
      texts,
      `the record of @convesoft/nx-rust's test runner cannot be read: ${record.unreadable}`,
    );
  }
  const broken = record.records.find(
    (entry) => entry.malformed !== undefined || entry.start === undefined,
  );
  if (broken !== undefined) {
    return failEvery(
      crates,
      texts,
      `the record ${broken.file} of @convesoft/nx-rust's test runner is malformed${broken.malformed === undefined ? "" : `: ${JSON.stringify(broken.malformed)}`}`,
    );
  }
  const errors = record.records.flatMap((entry) =>
    entry.after.flatMap((item) => ("error" in item ? [item.error] : [])),
  );
  if (errors.length > 0) {
    return failEvery(
      crates,
      texts,
      `@convesoft/nx-rust's test runner refused to run a test executable: ${[...new Set(errors)].join("; ")}`,
    );
  }
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  const records = record.records.map((entry) => ({
    ...entry,
    real: real((entry.start as { program: string }).program),
  }));
  const ended = (entry: (typeof records)[number]) =>
    entry.after.find((item): item is Extract<RecordEntry, { end: unknown }> => "end" in item)?.end;
  const recordFailed = (entry: (typeof records)[number]) => {
    const last = ended(entry);
    return (
      !entry.after.some((item) => "skip" in item) &&
      (last === undefined || !("status" in last) || last.status !== 0)
    );
  };
  const outcomes = crates.map((crate, index): CrateOutcome => {
    const expected = [
      ...new Set(
        executables
          .filter((message) => message.package_id === crate.spec)
          .map((message) => real(message.executable)),
      ),
    ];
    const problems: string[] = [];
    for (const executable of expected) {
      const own = records.filter((entry) => entry.real === executable);
      if (own.length === 0) {
        problems.push(`${executable} has no record, so it never ran through the runner`);
        continue;
      }
      if (own.length > 1) {
        problems.push(`${executable} has ${own.length} records, where it should have one`);
        continue;
      }
      const [only] = own;
      const recordedPackage = (only.start as { package: string }).package;
      if (recordedPackage !== crate.name) {
        problems.push(
          `the record of ${executable} names the package ${JSON.stringify(recordedPackage)}, not ${crate.name}`,
        );
        continue;
      }
      if (only.after.some((item) => "skip" in item)) {
        problems.push(`the runner skipped ${executable}`);
        continue;
      }
      const last = ended(only);
      if (last === undefined) {
        problems.push(
          `the record of ${executable} has no end: the runner started it and was stopped before it ended`,
        );
      } else if ("signal" in last) {
        problems.push(`${executable} was ended by ${last.signal}`);
      } else if (last.status !== 0) {
        problems.push(
          `${executable} exited with status ${last.status}${last.status === 101 ? ", as a test binary does where a test failed" : last.status === 127 ? ", as a program that cannot be loaded or started does" : ""}`,
        );
      }
    }
    for (const entry of records) {
      if (
        (entry.start as { package: string }).package === crate.name &&
        !expected.includes(entry.real) &&
        recordFailed(entry)
      ) {
        problems.push(
          `the runner ran ${entry.real}, which cargo's messages do not name, and it did not end with status 0`,
        );
      }
    }
    if (problems.length === 0) {
      return { passed: true, output: texts[index] };
    }
    const noRecords = record.records.length === 0;
    return {
      passed: false,
      output: texts[index],
      message: [
        `${crate.task}: the record of @convesoft/nx-rust's test runner does not show that every test binary of ${crate.name} ran and passed: ${problems.join("; ")}.`,
        ...(noRecords
          ? [
              `The runner left no record at all. Cargo starts it as ${runner.command.map((word) => JSON.stringify(word)).join(" ")} for each test executable: look at NODE_OPTIONS, whose options apply to the runner as to every Node process, and at what keeps Node from starting.`,
            ]
          : []),
      ].join("\n"),
    };
  });
  if (
    end.kind === "failed" &&
    outcomes.every((outcome) => outcome.passed) &&
    !records.some(recordFailed)
  ) {
    return failEvery(
      crates,
      texts,
      "cargo test exited with status 101, and neither a failed build nor the record of @convesoft/nx-rust's test runner explains why",
    );
  }
  return outcomes;
}

// The output of the test binaries' step, per crate: the lines before the
// first `Running` line as compiler output, each block from a `Running` line
// to the crate whose test executable it names, a block of another member's
// executable left out, and cargo's closing list of failed targets to every
// crate. JSON lines before the first block are cargo's messages and shown to
// no one.
function attributeTestBinaries(
  lines: readonly string[],
  crates: readonly OutputCrate[],
  scope: OutputScope,
  executables: readonly (StepMessage & { executable: string })[],
): string[][] {
  const { body, list } = closingList(lines);
  const firstBlock = body.findIndex((line) => /^\s+Running /.test(plainLine(line)));
  const prelude = (firstBlock === -1 ? body : body.slice(0, firstBlock)).filter(
    (line) => !line.includes('{"reason":'),
  );
  const parts = attributeText(prelude, crates, scope);
  const owners = executables.map((message) => ({
    name: basename(message.executable).replace(/\.exe$/, ""),
    id: message.package_id ?? "",
  }));
  const memberIds = new Set(scope.members.map((member) => member.id));
  let target: number[] | "nobody" = crates.map((_, index) => index);
  for (const line of firstBlock === -1 ? [] : body.slice(firstBlock)) {
    if (/^\s+Running /.test(plainLine(line))) {
      const named = owners
        .filter((owner) => plainLine(line).includes(owner.name))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (named === undefined) {
        target = crates.map((_, index) => index);
      } else {
        const index = crates.findIndex((crate) => crate.spec === named.id);
        target =
          index !== -1 ? [index] : memberIds.has(named.id) ? "nobody" : crates.map((_, at) => at);
      }
    }
    if (target !== "nobody") {
      for (const index of target) {
        parts[index].push(line);
      }
    }
  }
  const shown = shownList(list, crates);
  for (const part of parts) {
    part.push(...shown);
  }
  return parts;
}

// Cargo's closing list of failed targets as the tasks show it: whole where
// an entry names a crate of the group, and left out where every entry names
// a crate outside it, of which the warnings speak.
function shownList(list: readonly string[], crates: readonly OutputCrate[]): readonly string[] {
  const names = new Set(crates.map((crate) => crate.name));
  return list.slice(1).some((line) => {
    const name = /^\s+`-p (\S+) /.exec(plainLine(line))?.[1];
    return name === undefined || names.has(name);
  })
    ? list
    : [];
}

/**
 * Reads the doctest step under `workspace-build`, `cargo test --workspace
 * --doc --no-fail-fast` (`DES-TEST-RUN`, "Doctest results"): cargo decides
 * every doctest as for a plain `cargo test --doc`. Where cargo exits with 0,
 * every crate passes; where it exits with 101, a crate passes where cargo's
 * list of failed targets, the last one and only where it ends the output,
 * names no target of its package; an entry without `-p` names the only
 * member. Every crate fails where cargo exits otherwise, where it fails
 * without a list that ends the output, where the list is not what its first
 * line announces, and where it names a package that is no member. A failing
 * doctest of a member outside the group fails no task: each crate gets a
 * warning that names it (`DES-DIAGNOSTICS`).
 *
 * Each crate's output holds the block after a `Doc-tests` line that names
 * its library, and the lines that the output does not attribute to one
 * crate; the blocks of other members are left out.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-DIAGNOSTICS
export function readDoctestStep(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  scope: OutputScope,
): CrateOutcome[] {
  const lines = splitLines(output);
  const { body, list, listStart } = closingList(lines);
  const libraryOf = (targets: readonly { name: string; kind: string[] }[] | undefined) =>
    (targets ?? [])
      .filter(
        (target) =>
          !target.kind.some((kind) =>
            ["bin", "test", "example", "bench", "custom-build"].includes(kind),
          ),
      )
      .map((target) => target.name.replace(/-/g, "_"));
  const outside = outsideMembers(crates, scope);
  const firstBlock = body.findIndex((line) => /^\s+Doc-tests \S+$/.test(plainLine(line)));
  const parts = attributeText(firstBlock === -1 ? body : body.slice(0, firstBlock), crates, scope);
  let target: number[] = crates.map((_, index) => index);
  for (const line of firstBlock === -1 ? [] : body.slice(firstBlock)) {
    const header = /^\s+Doc-tests (\S+)$/.exec(plainLine(line));
    if (header !== null) {
      const library = header[1].replace(/-/g, "_");
      const owners = crates.flatMap((crate, index) =>
        libraryOf(crate.package?.targets).includes(library) ? [index] : [],
      );
      target =
        owners.length > 0
          ? owners
          : scope.members.some(
                (member) =>
                  outside.ids.has(member.id) && libraryOf(member.targets).includes(library),
              )
            ? []
            : crates.map((_, index) => index);
    }
    for (const index of target) {
      parts[index].push(line);
    }
  }
  const shown = shownList(list, crates);
  for (const part of parts) {
    part.push(...shown);
  }
  const texts = parts.map((part) => part.join("\n"));
  if (end.kind === "succeeded") {
    return crates.map((_, index) => ({ passed: true, output: texts[index] }));
  }
  if (end.kind === "unexplained") {
    return failEvery(crates, texts, end.reason);
  }
  if (listStart === -1) {
    const names = notCompiled(lines);
    return crates.map((crate, index) => ({
      passed: false,
      output: texts[index],
      message:
        names.length === 0
          ? `${crate.task}: cargo test --doc failed before it printed which doctests failed, so its output does not show whether the doctests of ${crate.name} passed.`
          : `${crate.task}: the doctests of ${crate.name} were not run: cargo test --doc stopped, because ${describeNotCompiled(names, outside.names)} did not compile. Fix the crate that does not compile and run the tasks again.`,
    }));
  }
  const entries = list
    .slice(1)
    .map(plainLine)
    .filter((line) => line.trim() !== "");
  const announced = Number(/^error: (\d+)/.exec(plainLine(list[0]))?.[1]);
  const malformed = entries.find((line) => !/^\s+`(?:-p \S+ )?[^`]+`$/.test(line));
  if (malformed !== undefined) {
    return failEvery(
      crates,
      texts,
      `the list of failed doctest targets that ends cargo's output is malformed or does not end it: ${JSON.stringify(malformed)}`,
    );
  }
  if (entries.length !== announced) {
    return failEvery(
      crates,
      texts,
      `cargo announced ${announced} failed doctest ${announced === 1 ? "target" : "targets"} and listed ${entries.length}`,
    );
  }
  const only = scope.members.length === 1 ? scope.members[0].name : undefined;
  const failedNames = entries.map((line) => /^\s+`-p (\S+) /.exec(line)?.[1] ?? only);
  if (failedNames.some((name) => name === undefined)) {
    return failEvery(
      crates,
      texts,
      "cargo's list of failed doctest targets holds an entry without a package in a workspace of several members",
    );
  }
  const names = failedNames as string[];
  const strangers = names.filter((name) => !scope.members.some((member) => member.name === name));
  if (strangers.length > 0) {
    return failEvery(
      crates,
      texts,
      `cargo reported failed doctests of ${describeList([...new Set(strangers)].map((name) => `\`${name}\``))}, which is no member of the workspace`,
    );
  }
  const beyond = [...new Set(names.filter((name) => outside.names.has(name)))];
  const warning = (crate: OutputCrate) =>
    beyond.length === 0
      ? []
      : [
          `${crate.task}: warning: the doctests of ${describeList(beyond.map((name) => `\`${name}\``))} failed. ${beyond.length === 1 ? "That crate is" : "Those crates are"} outside this run's tasks: under workspace-build, the doctest step runs the doctests of every crate of the workspace, and no task of this run fails for ${beyond.length === 1 ? "it" : "them"}.`,
        ];
  return crates.map((crate, index) => {
    const own = entries.filter((_, at) => names[at] === crate.name);
    const notes = warning(crate);
    if (own.length === 0) {
      return {
        passed: true,
        output: texts[index],
        ...(notes.length === 0 ? {} : { message: notes.join("\n") }),
      };
    }
    return {
      passed: false,
      output: texts[index],
      message: [
        `${crate.task}: ${own.length === 1 ? "a doctest target" : `${own.length} doctest targets`} of ${crate.name} failed: ${own.map((line) => line.trim()).join(", ")}.`,
        ...notes,
      ].join("\n"),
    };
  });
}

// Cargo's list of failed targets that ends the output, if the last line of
// that form starts one: the lines before it, the list, and where it starts.
function closingList(lines: readonly string[]): {
  body: readonly string[];
  list: readonly string[];
  listStart: number;
} {
  const headers = lines.flatMap((line, index) =>
    /^error: \d+ targets? failed:$/.test(plainLine(line)) ? [index] : [],
  );
  const listStart = headers.length === 0 ? -1 : headers[headers.length - 1];
  return listStart === -1
    ? { body: lines, list: [], listStart }
    : { body: lines.slice(0, listStart), list: lines.slice(listStart), listStart };
}

/** The lines of a step's output, without the empty one after a last newline. */
export function splitLines(output: string): string[] {
  const lines = output.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
