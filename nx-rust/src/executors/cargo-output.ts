import { dirname, resolve, sep } from "node:path";
import type { CargoPackage, CargoTarget } from "../cargo/metadata";
import { type BuildSelection, enabledFeatures } from "./build-records";

/**
 * One crate of a cargo command that serves several tasks (`TERM-GROUP`), as
 * the reading of the command's output needs it.
 */
export interface OutputCrate {
  /** The task, as `<project>:<target>`. */
  task: string;
  /** The crate's package name, by which cargo's human-readable lines name it. */
  name: string;
  /** The crate's package ID specification, which cargo's JSON messages give as `package_id`. */
  spec: string;
  /**
   * The crate's targets, features and dependencies, as `cargo metadata
   * --no-deps` reports them; absent where the step needs none.
   */
  package?: CargoPackage;
  /** The task's feature selection, which decides the targets whose required features are on. */
  selection: BuildSelection;
}

/**
 * Escape sequences that a terminal reads: CSI sequences such as colours, and
 * OSC sequences such as hyperlinks, which cargo writes where
 * `CARGO_TERM_COLOR=always` or `term.hyperlinks` asks for them.
 */
// eslint-disable-next-line no-control-regex
const escapeSequences = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/**
 * A line of cargo's human-readable output without terminal escape
 * sequences, which the reading matches, while a task's output keeps the
 * line as cargo wrote it: cargo colours its status lines, errors and lists
 * where `CARGO_TERM_COLOR=always` asks it to, as CI configurations set it.
 * JSON messages are written without them.
 */
export function plainLine(line: string): string {
  return line.includes("\u001b") ? line.replace(escapeSequences, "") : line;
}

/** What a step's output shows for one crate. */
export interface CrateOutcome {
  /** Whether cargo's output shows that the crate passed the step. */
  passed: boolean;
  /** The crate's part of the step's output, in order, as text. */
  output: string;
  /** The message that says why the crate did not pass, or a warning about the step; absent otherwise. */
  message?: string;
}

/**
 * How a cargo command ended, as far as the reading of its output trusts it:
 * with status 0, with 101, the status that cargo gives a command that
 * failed, or otherwise, as by a signal, with another status or without
 * starting at all, which the reading cannot explain.
 */
export type CommandEnd =
  | { kind: "succeeded" }
  | { kind: "failed" }
  | { kind: "unexplained"; reason: string };

/**
 * How a cargo command ended ({@link CommandEnd}), from its exit status and
 * signal, or from why it did not start.
 */
export function commandEnd(
  code: number | null,
  signal: string | null,
  failure?: string,
): CommandEnd {
  if (failure === undefined && signal === null && code === 0) {
    return { kind: "succeeded" };
  }
  if (failure === undefined && signal === null && code === 101) {
    return { kind: "failed" };
  }
  return {
    kind: "unexplained",
    reason:
      failure ??
      (signal !== null
        ? `cargo was stopped by ${signal}`
        : `cargo exited with status ${code}, which is neither success nor the status of a command that failed`),
  };
}

/**
 * The members of the workspace of a command that selects the whole
 * workspace (`DES-UNIFICATION`), so that the reading can tell a crate
 * outside the group from a crate outside the workspace: what concerns only
 * a member outside the group is left out of every task's output, and a
 * failure there is reported as one outside the selection.
 */
export interface OutputScope {
  /** Every member of the workspace, as `cargo metadata --no-deps` reports it. */
  members: readonly CargoPackage[];
  /** The absolute path of the workspace root, where cargo ran. */
  root: string;
}

/**
 * Fails every crate of a command whose output the reading cannot trust, with
 * a message that says why ({@link readJsonStep}, {@link readTestStep}).
 */
export function failEvery(
  crates: readonly OutputCrate[],
  parts: readonly string[],
  why: string,
): CrateOutcome[] {
  return crates.map((crate, index) => ({
    passed: false,
    output: parts[index] ?? "",
    message: `${crate.task}: ${why}, so the output does not show that ${crate.name} passed. Unknown counts as failed: run the task again, or with --batch=false to see cargo's own result for its crate.`,
  }));
}

/**
 * A unit that cargo compiles for a target: the target in normal mode, or
 * compiled as a test, as its JSON messages tell by `profile.test`.
 */
export interface Unit {
  /** The target's name. */
  name: string;
  /** What the target is, as {@link targetClass} names it. */
  kind: TargetClass;
  /** Whether the unit is the target compiled as a test. */
  test: boolean;
}

/** The kinds of target that the reading tells apart; every library crate type counts as `lib`. */
export type TargetClass = "lib" | "bin" | "test" | "example" | "bench" | "custom-build";

/** The class of a target, from its `kind` list in a `cargo metadata` report or a JSON message. */
export function targetClass(kind: readonly string[]): TargetClass {
  for (const name of ["bin", "test", "example", "bench", "custom-build"] as const) {
    if (kind.includes(name)) {
      return name;
    }
  }
  return "lib";
}

/**
 * The units of a crate that a `build`, `check` or `clippy` command builds
 * whatever else it selects (`DES-BATCH`, "Builds, checks and clippy"): of
 * the crate's library, binaries, tests, examples and benchmarks, those that
 * the command's flags select and whose required features the task's own
 * selection turns on.
 *
 * Without `--all-targets`, that is the library and the binaries. With it,
 * cargo 1.91.0 and 1.100.0 also compile the examples, and compile as a test
 * every target that `--tests` or `--benches` selects: the library and each
 * binary, test and example whose `test` flag is on, and the library, each
 * binary and each bench target whose `bench` flag is on. The report does
 * not give the `bench` flag, which is on by default for these three kinds,
 * so the library, the binaries and the bench targets count as compiled as
 * tests whatever their flags say. That can only fail a task whose crate
 * turned both flags off, and only when the command fails, while leaving out
 * a unit could pass a task whose test units cargo never reached, as when a
 * dev-dependency does not compile and the crate has no other test target.
 */
// @mara implements DES-BATCH
export function expectedUnits(
  pkg: CargoPackage,
  allTargets: boolean,
  selection: BuildSelection,
): Unit[] {
  const enabled = enabledFeatures(
    pkg.name,
    pkg.features ?? {},
    selection,
    optionalDependencies(pkg),
  );
  const turnedOn = (target: CargoTarget) =>
    (target["required-features"] ?? []).every((feature) => enabled.has(feature));
  const units: Unit[] = [];
  for (const target of pkg.targets) {
    const kind = targetClass(target.kind);
    if (kind === "custom-build" || !turnedOn(target)) {
      continue;
    }
    const normal = kind === "lib" || kind === "bin" || (allTargets && kind === "example");
    if (normal) {
      units.push({ name: target.name, kind, test: false });
    }
    if (!allTargets) {
      continue;
    }
    const testFlag = target.test !== false;
    const asTest =
      kind === "lib" ||
      kind === "bin" ||
      kind === "bench" ||
      ((kind === "test" || kind === "example") && testFlag);
    if (asTest) {
      units.push({ name: target.name, kind, test: true });
    }
  }
  return units;
}

// The names under which the crate lists its optional dependencies that no
// platform limits, as `buildRecordSource` gives them for the build records.
function optionalDependencies(pkg: CargoPackage): string[] {
  return [
    ...new Set(
      pkg.dependencies
        .filter((dependency) => dependency.optional === true && !dependency.target)
        .map((dependency) => dependency.rename ?? dependency.name),
    ),
  ];
}

/**
 * One line of a command's output: a JSON message of cargo, a line of text,
 * or a line that starts as a JSON message of cargo and is none, such as one
 * cut short.
 */
type OutputLine = { json: CargoMessage } | { text: string } | { malformed: string };

/** The parts of a JSON message of cargo that the reading uses. */
interface CargoMessage {
  reason?: string;
  package_id?: string;
  target?: { name?: string; kind?: string[] };
  profile?: { test?: boolean };
  message?: { level?: string; rendered?: string | null };
}

/** The members of a workspace outside a group, and how to tell their lines. */
export interface OutsideMembers {
  /** Their package ID specifications. */
  ids: ReadonlySet<string>;
  /** Their package names. */
  names: ReadonlySet<string>;
  /**
   * Whether a line of cargo's text that starts a block concerns one of them
   * alone: a status line that names one by its name and folder, a
   * diagnostic's summary that names one, or a location in its folder.
   */
  ownsLine(line: string): boolean;
  /** The member outside the group whose folder holds `path`, relative to the workspace root. */
  atPath(path: string): CargoPackage | undefined;
}

/** The members outside the group of `crates` ({@link OutsideMembers}); none without a scope. */
export function outsideMembers(
  crates: readonly OutputCrate[],
  scope: OutputScope | undefined,
): OutsideMembers {
  const inGroup = new Set(crates.map((crate) => crate.spec));
  const members = (scope?.members ?? []).filter((member) => !inGroup.has(member.id));
  const folders = members
    .map((member) => ({ member, folder: resolve(dirname(member.manifest_path)) }))
    .sort((a, b) => b.folder.length - a.folder.length);
  const atPath = (path: string): CargoPackage | undefined => {
    const file = resolve(scope?.root ?? ".", path);
    // The deepest member folder that holds the file, among every member, so
    // that a member nested in another's folder is told apart.
    const all = (scope?.members ?? [])
      .map((member) => ({ member, folder: resolve(dirname(member.manifest_path)) }))
      .sort((a, b) => b.folder.length - a.folder.length);
    const holder = all.find(
      ({ folder }) =>
        file === folder || file.startsWith(folder.endsWith(sep) ? folder : folder + sep),
    );
    return holder !== undefined && !inGroup.has(holder.member.id) ? holder.member : undefined;
  };
  return {
    ids: new Set(members.map((member) => member.id)),
    names: new Set(members.map((member) => member.name)),
    atPath,
    ownsLine: (raw) => {
      const line = plainLine(raw);
      const status = /^\s*[A-Z][a-z]+ (\S+) v\S+ \(([^)]+)\)/.exec(line);
      if (status !== null) {
        return folders.some(
          ({ member, folder }) => member.name === status[1] && folder === resolve(status[2]),
        );
      }
      const summary = /^warning: `([^`]+)` \(/.exec(line) ?? /^\s*-->\s+(.+?):\d+:\d+$/.exec(line);
      if (summary === null) {
        return false;
      }
      return line.includes("-->")
        ? atPath(summary[1]) !== undefined
        : members.some((member) => member.name === summary[1]);
    },
  };
}

// The command's output, line by line, with each line that holds a JSON
// message of cargo parsed.
function outputLines(output: string): OutputLine[] {
  const lines = output.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.map((line) => {
    if (line.startsWith('{"reason":')) {
      try {
        return { json: JSON.parse(line) as CargoMessage };
      } catch {
        return { malformed: line };
      }
    }
    return { text: line };
  });
}

/**
 * Reads the output of a `build`, `check` or `clippy` command with
 * `--keep-going` and `--message-format=json` that selected several crates
 * (`DES-BATCH`, "Builds, checks and clippy"; `EVD-CARGO-BATCH-FAILURES`).
 *
 * The output counts only where it is whole: every crate fails, with a
 * message that says why, where cargo ended in a way that the reading cannot
 * explain ({@link CommandEnd}), where a line that starts as a JSON message is
 * none, as one cut short, where the messages end without `build-finished`,
 * which cargo prints last, or where that message contradicts the exit
 * status. Unknown counts as failed.
 *
 * When cargo succeeded, every crate passed. Otherwise a crate passes only
 * when the messages report an artifact for each of its {@link expectedUnits}
 * and no error for any of its targets. A failed crate's message names its
 * units that cargo did not report and the crates that cargo reported as
 * failed, by their errors, the build scripts that failed and the crates that
 * did not compile; a crate that fails because it needs one of them has no
 * error of its own. Where cargo failed and every crate passed, each gets a
 * warning that cargo failed outside them.
 *
 * Each crate's output holds, in order, the rendered diagnostics of its own
 * package, and every line of text and every diagnostic of another package
 * that the output does not attribute to another crate of the command.
 *
 * @param allTargets Whether the command passed `--all-targets`.
 */
// @mara implements DES-BATCH
export function readJsonStep(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  allTargets: boolean,
  scope?: OutputScope,
): CrateOutcome[] {
  const lines = outputLines(output);
  // The members outside the group, whose own lines no task shows.
  const outside = outsideMembers(crates, scope);
  const messages = lines.flatMap((line) => ("json" in line ? [line.json] : []));
  const bySpec = new Map(crates.map((crate, index) => [crate.spec, index]));
  // The packages that the messages name, by their names, to tell where a
  // line of text that names a package by its name alone is ambiguous.
  const idsByName = new Map<string, Set<string>>();
  for (const message of messages) {
    if (typeof message.package_id === "string") {
      const name = packageName(message.package_id);
      idsByName.set(name, (idsByName.get(name) ?? new Set()).add(message.package_id));
    }
  }
  const owner = textOwner(crates, idsByName);
  const parts = crates.map(() => [] as string[]);
  const everyone = (text: string) => parts.forEach((part) => part.push(text));
  let current: number | undefined;
  let dropped = false;
  for (const line of lines) {
    if ("malformed" in line) {
      everyone(line.malformed);
      continue;
    }
    if ("json" in line) {
      const { json } = line;
      const rendered = json.reason === "compiler-message" ? json.message?.rendered : undefined;
      if (typeof rendered === "string" && rendered !== "") {
        const index = bySpec.get(json.package_id ?? "");
        const text = rendered.replace(/\n$/, "");
        if (index !== undefined) {
          parts[index].push(text);
        } else if (
          !outside.ids.has(json.package_id ?? "") ||
          (json.message?.level ?? "").startsWith("error")
        ) {
          // A member outside the group shows only its errors, which can
          // explain why a task that needs it fails.
          everyone(text);
        }
      }
      continue;
    }
    if (startsBlock(line.text)) {
      current = owner(line.text);
      dropped =
        current === undefined &&
        !plainLine(line.text).startsWith("error") &&
        outside.ownsLine(line.text);
    }
    if (dropped) {
      continue;
    }
    if (current === undefined) {
      everyone(line.text);
    } else {
      parts[current].push(line.text);
    }
  }
  const texts = parts.map((part) => part.join("\n"));
  if (end.kind === "unexplained") {
    return failEvery(crates, texts, end.reason);
  }
  if (lines.some((line) => "malformed" in line)) {
    return failEvery(crates, texts, "a line of cargo's JSON messages is cut short or malformed");
  }
  const finished = messages.filter((message) => message.reason === "build-finished");
  if (finished.length !== 1) {
    return failEvery(
      crates,
      texts,
      finished.length === 0
        ? "cargo's JSON messages end without build-finished, which cargo prints when the build has ended"
        : "cargo's JSON messages hold build-finished more than once",
    );
  }
  const reported = (finished[0] as { success?: unknown }).success;
  if (reported !== (end.kind === "succeeded")) {
    return failEvery(
      crates,
      texts,
      `cargo's build-finished message says success: ${JSON.stringify(reported)}, while cargo ${end.kind === "succeeded" ? "succeeded" : "failed"}`,
    );
  }
  const failed = failedPackages(lines);
  return crates.map((crate, index) => {
    const text = texts[index];
    if (end.kind === "succeeded") {
      return { passed: true, output: text };
    }
    const errors = messages.some(
      (message) =>
        message.reason === "compiler-message" &&
        message.package_id === crate.spec &&
        (message.message?.level ?? "").startsWith("error"),
    );
    const built = messages.filter(
      (message) => message.reason === "compiler-artifact" && message.package_id === crate.spec,
    );
    const missing = (
      crate.package === undefined
        ? undefined
        : expectedUnits(crate.package, allTargets, crate.selection)
    )?.filter(
      (unit) =>
        !built.some(
          (message) =>
            message.target?.name === unit.name &&
            targetClass(message.target?.kind ?? []) === unit.kind &&
            (message.profile?.test === true) === unit.test,
        ),
    );
    if (missing !== undefined && missing.length === 0 && !errors) {
      const beyond = failed.filter((name) => outside.names.has(name.slice(1, -1)));
      return {
        passed: true,
        output: text,
        message: `${crate.task}: cargo failed, but not for ${crate.name}: its output shows every target of ${crate.name} that this task builds as built, and no error in it.${failed.length === 0 ? "" : ` cargo reported ${describeList(failed)} as failed.`}${beyond.length === 0 ? "" : ` ${describeList(beyond)} ${beyond.length === 1 ? "is" : "are"} outside the selection of this run: under workspace-build, every cargo command builds the whole workspace, and a failure in a crate that no task of the run needs fails no task.`}`,
      };
    }
    const why =
      missing === undefined
        ? `@convesoft/nx-rust does not know the targets of ${crate.name}, so the output cannot show that they were built`
        : [
            ...(errors ? [`cargo reported errors in ${crate.name}`] : []),
            ...(missing.length > 0
              ? [
                  `cargo did not report ${missing.length === 1 ? "this target" : "these targets"} of ${crate.name} as built: ${missing.map(describeUnit).join(", ")}`,
                ]
              : []),
          ].join(", and ");
    const cause =
      failed.length === 0
        ? "cargo's output names no crate that failed."
        : `cargo reported ${describeList(failed)} as failed: a task fails when its own crate fails or when it needs a crate that failed.`;
    return {
      passed: false,
      output: text,
      message: `${crate.task}: ${why}. ${cause}`,
    };
  });
}

/**
 * Reads the output of a `cargo test --no-fail-fast` that selected several
 * crates (`DES-TEST-RUN`, "Attributing the output of `cargo test`";
 * `EVD-CARGO-BATCH-FAILURES`).
 *
 * The output counts only where it is whole: every crate fails, with a
 * message that says why, where cargo ended in a way that the reading cannot
 * explain ({@link CommandEnd}), or where the list of failed targets that
 * ends the output is not exactly what its first line announces, as when
 * cargo was stopped while it printed it, or a line after it is no entry of
 * the list. Only that last list counts: a line that a test prints, which
 * looks like the first line of a list, earlier in the output changes
 * nothing. Unknown counts as failed.
 *
 * When cargo succeeded, every crate passed. When it failed and printed its
 * list of failed targets, which names each package by its bare name, the
 * crates that the list names failed and the others passed; a name in the
 * list that is no crate of the command fails every crate, since the output
 * then cannot tell which crate it belongs to. When it failed without the
 * list, as after a compile error, which stops the run before any test runs,
 * every crate failed, and the message names the crates that did not compile
 * and says that the tests of the others were not run.
 *
 * Each block of the output, from a `Running` or `Doc-tests` line to the next,
 * goes to the crates that have a target of the name in its header, or to
 * the crate that its line `to rerun pass \`-p <name> ...\`` names; a block
 * that it cannot attribute to one crate goes to every crate it could
 * belong to, and the lines before the first block and the closing list go
 * to every crate.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-BATCH
export function readTestStep(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
): CrateOutcome[] {
  // Test output is text: a test may print anything, a line of JSON included.
  const lines = output.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  // Cargo's list of failed targets is the last thing it prints. A test can
  // print a line that looks like its first line, so only the last such line
  // counts, and only where the list after it ends the output.
  const headers = lines.flatMap((line, index) =>
    /^error: \d+ targets? failed:$/.test(plainLine(line)) ? [index] : [],
  );
  const listStart = headers.length === 0 ? -1 : headers[headers.length - 1];
  const body = listStart === -1 ? lines : lines.slice(0, listStart);
  const list = listStart === -1 ? [] : lines.slice(listStart);
  const parts = crates.map(() => [] as string[]);
  const all = crates.map((_, index) => index);
  let block: string[] = [];
  let candidates: number[] = all;
  const flush = () => {
    const rerun = block
      .map((line) => /to rerun pass `-p (\S+)/.exec(plainLine(line))?.[1])
      .find((name) => name !== undefined);
    const named = rerun === undefined ? -1 : crates.findIndex((crate) => crate.name === rerun);
    for (const index of named === -1 ? candidates : [named]) {
      parts[index].push(...block);
    }
    block = [];
  };
  for (const line of body) {
    const header = testBlockTarget(line);
    if (header !== undefined) {
      flush();
      const owners = all.filter((index) => hasTarget(crates[index], header));
      candidates = owners.length === 0 ? all : owners;
    }
    block.push(line);
  }
  flush();
  for (const part of parts) {
    part.push(...list);
  }
  const texts = parts.map((part) => part.join("\n"));
  if (end.kind === "unexplained") {
    return failEvery(crates, texts, end.reason);
  }
  // Every line of the list after its first names one failed target, as
  // `-p <package> <target flag>` in backquotes, and there are as many as the
  // first line announces.
  const entries = list
    .slice(1)
    .map(plainLine)
    .filter((line) => line.trim() !== "");
  const announced = listStart === -1 ? 0 : Number(/^error: (\d+)/.exec(plainLine(list[0]))?.[1]);
  const malformed = entries.find((line) => !/^\s+`-p \S+ [^`]+`$/.test(line));
  if (end.kind === "failed" && listStart !== -1 && malformed !== undefined) {
    return failEvery(
      crates,
      texts,
      `the list of failed test targets that ends cargo's output is malformed or does not end it: ${JSON.stringify(malformed)}`,
    );
  }
  if (end.kind === "failed" && listStart !== -1 && entries.length !== announced) {
    return failEvery(
      crates,
      texts,
      `cargo announced ${announced} failed test ${announced === 1 ? "target" : "targets"} and listed ${entries.length}`,
    );
  }
  const failedNames = entries.flatMap((line) => {
    const name = /^\s+`-p (\S+)/.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
  const notCompiled = [
    ...new Set(
      lines.flatMap((line) => {
        const name = /^error: could not compile `([^`]+)`/.exec(plainLine(line))?.[1];
        return name === undefined ? [] : [name];
      }),
    ),
  ];
  const unknown = failedNames.filter((name) => !crates.some((crate) => crate.name === name));
  return crates.map((crate, index) => {
    const text = texts[index];
    if (end.kind === "succeeded") {
      return { passed: true, output: text };
    }
    if (listStart === -1) {
      return {
        passed: false,
        output: text,
        message:
          notCompiled.length === 0
            ? `${crate.task}: cargo test failed before it printed which test targets failed, so its output does not show whether the tests of ${crate.name} passed.`
            : `${crate.task}: the tests of ${crate.name} were not run: cargo test stopped before running any test, because ${describeList(notCompiled.map((name) => `\`${name}\``))} did not compile. The tests of every crate of this cargo command were not run. Fix the crate that does not compile and run the tasks again.`,
      };
    }
    if (unknown.length > 0) {
      return {
        passed: false,
        output: text,
        message: `${crate.task}: cargo test reported failed test targets of ${describeList(unknown.map((name) => `\`${name}\``))}, which is no crate of this cargo command, so its output does not show whether the tests of ${crate.name} passed.`,
      };
    }
    const own = entries.filter((line) => new RegExp(`^\\s+\`-p ${escape(crate.name)} `).test(line));
    return own.length === 0
      ? { passed: true, output: text }
      : {
          passed: false,
          output: text,
          message: `${crate.task}: ${own.length === 1 ? "a test target" : `${own.length} test targets`} of ${crate.name} failed: ${own.map((line) => line.trim()).join(", ")}.`,
        };
  });
}

// The target that a line of `cargo test` that starts a block names: the
// file name of the test executable without its hash, as in `Running
// unittests src/lib.rs (target/debug/deps/good-1a2b3c)`, or the library of
// `Doc-tests good`.
function testBlockTarget(raw: string): string | undefined {
  const line = plainLine(raw);
  const doc = /^\s+Doc-tests (\S+)$/.exec(line);
  if (doc !== undefined && doc !== null) {
    return doc[1];
  }
  const running = /^\s+Running .*\(([^()]+)\)$/.exec(line);
  if (running === null) {
    return undefined;
  }
  const file = running[1].split(/[\\/]/).at(-1) ?? "";
  return file.replace(/\.exe$/, "").replace(/-[0-9a-f]{16}$/, "");
}

// Whether a crate has a target whose name, as a test executable or a
// library's doctests name it, is `name`.
function hasTarget(crate: OutputCrate, name: string): boolean {
  return (crate.package?.targets ?? []).some(
    (target) => target.name.replace(/-/g, "_") === name.replace(/-/g, "_"),
  );
}

/**
 * Whether a line of cargo's text output starts a block of its own: an
 * error, a warning or a note, or one of cargo's status lines.
 */
export function startsBlock(raw: string): boolean {
  const line = plainLine(raw);
  return (
    /^(error|warning|note)(\[[^\]]*\])?: /.test(line) ||
    /^\s*(Compiling|Checking|Fresh|Finished|Running|Doc-tests|Documenting|Building|Blocking|Downloading|Downloaded|Updating|Locking|Adding|Removing|Packaging|Scraping|Waiting|Dirty|Ignored)\b/.test(
      line,
    )
  );
}

// Which crate of the command a block of text belongs to, from its first
// line: a status line that names the crate with its folder, or an error or
// warning that names it in backquotes, such as "could not compile `core`".
// A name that two packages of the output share, or that the line names
// without a folder while another package has it, belongs to no one crate.
function textOwner(
  crates: readonly OutputCrate[],
  idsByName: ReadonlyMap<string, ReadonlySet<string>>,
): (line: string) => number | undefined {
  return (raw) => {
    const line = plainLine(raw);
    const status = /^\s*[A-Z][a-z]+ (\S+) v\S+ \(([^)]+)\)/.exec(line);
    const quoted = /`([A-Za-z0-9_-]+)(?: v[^ `]+(?: \(([^)]+)\))?)?`/.exec(line);
    const match = status ?? quoted;
    if (match === null) {
      return undefined;
    }
    const [, name, folder] = match;
    const index = crates.findIndex((crate) => crate.name === name);
    if (index === -1) {
      return undefined;
    }
    if (folder !== undefined) {
      const manifest = crates[index].package?.manifest_path;
      return manifest !== undefined && resolve(dirname(manifest)) === resolve(folder)
        ? index
        : undefined;
    }
    const ids = idsByName.get(name);
    return ids === undefined || [...ids].every((id) => id === crates[index].spec)
      ? index
      : undefined;
  };
}

// The packages that cargo reported as failed: those of its error messages,
// those whose build script it could not run and those it could not compile,
// by name, each once, in the order the output names them.
function failedPackages(lines: readonly OutputLine[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    if ("json" in line) {
      const { json } = line;
      if (
        json.reason === "compiler-message" &&
        (json.message?.level ?? "").startsWith("error") &&
        typeof json.package_id === "string"
      ) {
        names.push(packageName(json.package_id));
      }
      continue;
    }
    if (!("text" in line)) {
      continue;
    }
    const text = plainLine(line.text);
    const failed =
      /^error: failed to run custom build command for `(\S+)/.exec(text) ??
      /^error: could not compile `([^`]+)`/.exec(text);
    if (failed !== null) {
      names.push(failed[1]);
    }
  }
  return [...new Set(names)].map((name) => `\`${name}\``);
}

/**
 * The package name in a package ID specification, as cargo's JSON messages
 * give it: `path+file:///repo/crates/core#core-lib@0.1.0` names `core-lib`,
 * and `path+file:///repo/crates/core#0.1.0` the folder's name, `core`.
 */
export function packageName(spec: string): string {
  const fragment = spec.includes("#") ? spec.slice(spec.lastIndexOf("#") + 1) : "";
  const at = fragment.lastIndexOf("@");
  if (at > 0) {
    return fragment.slice(0, at);
  }
  if (fragment !== "" && !/^\d/.test(fragment)) {
    return fragment;
  }
  const base = spec.slice(0, spec.includes("#") ? spec.lastIndexOf("#") : undefined);
  return decodeURIComponent(base.split(/[\\/]/).at(-1) ?? base);
}

function describeUnit(unit: Unit): string {
  const target =
    unit.kind === "lib"
      ? "the library"
      : `the ${unit.kind === "bin" ? "binary" : unit.kind} ${unit.name}`;
  return unit.test ? `${target} compiled as a test` : target;
}

export function describeList(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
