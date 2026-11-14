import type { Task } from "@nx/devkit";
import { isDeepStrictEqual } from "node:util";
import type { InferredTargetName } from "../graph/targets";
import { type CargoTargetOptions, targetTakes } from "./command";
import { parseAsNx } from "./nx-command";
import { SplitError, splitWords } from "./split-words";

/** What the comparison needs to know about the executor that runs a task. */
export interface ExecutorOptions {
  /** The executor's full name, such as `@convesoft/nx-rust:cargo`. */
  name: string;
  /** How a warning line names it, such as `cargo` in "the cargo executor". */
  shortName: string;
  /** The options that its schema declares. */
  declared: ReadonlySet<string>;
}

/** One task's options, and what tells where they came from. */
export interface OptionSubject {
  /** The task as `nx show target` takes it, `<project>:<target>`. */
  task: string;
  /** The default name of the task's target. */
  target: InferredTargetName;
  /** The executor that runs the task. */
  executor: ExecutorOptions;
  /** The options that this invocation received. */
  options: Readonly<Record<string, unknown>>;
  /**
   * The options that the target's configuration gives, before options from
   * the command line or forwarded from another task: its `options` with the
   * active configuration's laid over them, as Nx merges them.
   */
  configured: Readonly<Record<string, unknown>>;
  /** The task that the task graph in the executor's context holds for this invocation, if any. */
  graphTask: Task | undefined;
  /** The arguments of the `nx` command, as the plugin's hook recorded them, if it did. */
  record: readonly string[] | undefined;
}

/** What a task does with its options. */
export interface TaskOptions {
  /** The options that the task's target takes, for its cargo command. */
  options: CargoTargetOptions;
  /** The binary's arguments, for `run`; empty for every other target. */
  binaryArguments: string[];
  /** One warning line per option that the task ignores, for the top of its output. */
  warnings: string[];
}

/**
 * An option's value that the task cannot use, such as an `args` that does
 * not split into words; its message names the task and the option.
 */
export class OptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionError";
  }
}

/**
 * Sorts a task's options into those its target takes and those it ignores,
 * and gives `run` its binary's arguments (`DES-UNKNOWN-OPTIONS`).
 *
 * An option that the executor's schema does not declare, or that it declares
 * but the target does not take ({@link targetTakes}), stays out of the
 * command and gets one warning line ({@link ignoredOptionLine}). On `run`,
 * the value of `args` and, when {@link forwardedArguments} finds them, the
 * arguments after `--` on the command line go to the binary; none of the
 * latter is taken as an option or gets a line.
 *
 * It looks at one task only, so that the batch implementation can call it
 * for each task of a batch.
 *
 * @throws {OptionError} When `args` does not split into words.
 */
// @mara implements DES-UNKNOWN-OPTIONS
// @mara implements REQ-UNKNOWN-OPTIONS
export function taskOptions(subject: OptionSubject): TaskOptions {
  const { executor, target } = subject;
  const options: Record<string, unknown> = { ...subject.options };
  let forwarded: string[] = [];
  if (target === "run") {
    const found = forwardedArguments(subject);
    if (found !== undefined) {
      forwarded = found.words;
      // Taken from the arguments, not as options: `run`'s own options keep
      // their configured value, and other options are left out unseen.
      for (const name of found.optionNames) {
        if (executor.declared.has(name) && name in subject.configured) {
          options[name] = subject.configured[name];
        } else {
          delete options[name];
        }
      }
    }
  }
  const taken: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    const declared = executor.declared.has(name);
    if (declared && targetTakes(target, name)) {
      taken[name] = value;
    } else {
      warnings.push(ignoredOptionLine(subject, name, value, declared ? "not-taken" : "unknown"));
    }
  }
  const binaryArguments =
    target === "run" ? [...argsWords(subject.task, taken.args), ...forwarded] : [];
  return { options: taken as CargoTargetOptions, binaryArguments, warnings };
}

/** Why a task ignores an option. */
export type IgnoredBecause = "unknown" | "not-taken";

/**
 * The warning line for an option that a task ignores. It names the task and
 * the option and says either that the option was passed on the command line,
 * when {@link passedOnCommandLine} is sure of it, with what to do about the
 * flag or words ({@link commandLineRemedy}), or that it comes from the
 * workspace's configuration, with the command that shows where and the two
 * fixes for a `targetDefaults` entry.
 *
 * Positional words, which Nx hands a task as the option `_`, are named as
 * such.
 */
// @mara implements DES-UNKNOWN-OPTIONS
export function ignoredOptionLine(
  subject: OptionSubject,
  name: string,
  value: unknown,
  because: IgnoredBecause,
): string {
  const { task, executor } = subject;
  const words = name === "_" && Array.isArray(value);
  const option = words
    ? `the positional arguments ${JSON.stringify(value.map(String))} (option \`_\`)`
    : `option \`${name}\``;
  const reason =
    because === "unknown"
      ? `which the ${executor.shortName} executor does not know`
      : "which this target does not take";
  if (passedOnCommandLine(subject, name, value)) {
    const remedy = commandLineRemedy(subject.target, words ? "words" : because);
    return because === "unknown"
      ? `${task}: ignoring ${option}, passed on the command line. ${remedy}`
      : `${task}: ignoring ${option}, ${reason}, passed on the command line. ${remedy}`;
  }
  return [
    `${task}: ignoring ${option}, ${reason}.`,
    `It comes from the workspace's configuration: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry.`,
    `If it is a \`targetDefaults\` entry in nx.json, add a \`filter\` to it or add an empty entry keyed by "${executor.name}".`,
  ].join(" ");
}

/**
 * What the line for a flag or words typed on the command line tells the user
 * to do (`DES-UNKNOWN-OPTIONS`, paragraph "Source"): to remove an option that
 * the executor does not know or check its spelling, to remove one that the
 * target does not take, and to remove positional words. Only `run` passes
 * arguments on, to its binary, so on `run` the line for an unknown option or
 * for words also names the two ways to do that; `test` has no option for
 * arguments of the test binary.
 */
function commandLineRemedy(target: InferredTargetName, what: IgnoredBecause | "words"): string {
  switch (what) {
    case "words":
      return target === "run"
        ? "Remove them, or pass them to the binary after `--` or with `--args`."
        : "Remove them.";
    case "not-taken":
      return "Remove it.";
    case "unknown":
      return target === "run"
        ? "Remove it or check its spelling, or pass it to the binary after `--` or with `--args`."
        : "Remove it, or check its spelling.";
  }
}

/**
 * Whether the option `name` with `value` was passed on the command line of
 * the `nx` command, which holds only when three records agree
 * (`DES-UNKNOWN-OPTIONS`, paragraph "Command line"):
 *
 * 1. The graph task holds the option among its overrides with the same value.
 * 2. That task's own `__overrides_unparsed__` lists it as `--<name>`,
 *    `--<name>=<value>`, `--no-<name>` or, for a one-letter name,
 *    `-<name>`, before any `--` in that list.
 * 3. The same flag is among the recorded arguments of the `nx` command.
 *
 * For `_`, the positional words, the list parsed as Nx parses it gives the
 * same words, and each word of the list that can be positional is among the
 * recorded arguments. Where Nx gave a declared option its camel-case name,
 * the overrides and the flag may still have the spelling with dashes.
 */
// @mara implements DES-UNKNOWN-OPTIONS
export function passedOnCommandLine(subject: OptionSubject, name: string, value: unknown): boolean {
  const { graphTask, record } = subject;
  const overrides: Record<string, unknown> | undefined = graphTask?.overrides;
  const unparsed = overrides?.__overrides_unparsed__;
  if (overrides === undefined || !isWordList(unparsed) || record === undefined) {
    return false;
  }
  if (name === "_") {
    return (
      isDeepStrictEqual(overrides._, value) &&
      isDeepStrictEqual(parseAsNx(unparsed)._, value) &&
      positionalWords(unparsed).every((word) => record.includes(word))
    );
  }
  const flags = beforeDoubleDash(unparsed);
  return Object.keys(overrides)
    .filter(
      (key) => key === name || (subject.executor.declared.has(name) && nxCamelCase(key) === name),
    )
    .some((key) => {
      if (!isDeepStrictEqual(overrides[key], value)) {
        return false;
      }
      const flag = flags.find((word) => isFlagFor(word, key));
      return flag !== undefined && record.includes(flag);
    });
}

/**
 * The arguments after `--` on the command line that a `run` task passes to
 * its binary, and the names under which the invocation's options hold what
 * Nx parsed from them, or `undefined` when the task passes none. They are
 * passed only when three conditions hold (`DES-UNKNOWN-OPTIONS`, paragraph
 * "run"): the record has `--`; the graph task's own
 * `__overrides_unparsed__` equals the recorded arguments after it; and the
 * invocation's options hold every option that Nx parses from those
 * arguments, apart from the executor's own, with the same value. A missing
 * record counts as a command without `--`.
 */
// @mara implements DES-UNKNOWN-OPTIONS
// @mara implements DES-TARGET-COMMANDS
export function forwardedArguments(
  subject: OptionSubject,
): { words: string[]; optionNames: string[] } | undefined {
  const { record, graphTask, executor } = subject;
  const separator = record?.indexOf("--") ?? -1;
  if (record === undefined || separator === -1) {
    return undefined;
  }
  const words = record.slice(separator + 1);
  const unparsed: unknown = graphTask?.overrides?.__overrides_unparsed__;
  if (!isWordList(unparsed) || !isDeepStrictEqual(unparsed, words)) {
    return undefined;
  }
  const optionNames = Object.entries(parseAsNx(words)).map(([key, parsed]) => {
    const name = executor.declared.has(nxCamelCase(key)) ? nxCamelCase(key) : key;
    return { name, parsed };
  });
  const held = optionNames.every(
    ({ name, parsed }) =>
      executor.declared.has(name) || isDeepStrictEqual(subject.options[name], parsed),
  );
  return held ? { words, optionNames: optionNames.map(({ name }) => name) } : undefined;
}

// The words of `args`, for the binary.
function argsWords(task: string, args: unknown): string[] {
  if (typeof args !== "string") {
    return [];
  }
  try {
    return splitWords(args);
  } catch (error) {
    if (!(error instanceof SplitError)) {
      throw error;
    }
    const problem =
      error.problem === "unterminated-quote"
        ? "has a quote that is not closed. Close it, or put a backslash before a quote that is part of an argument."
        : "ends in a backslash, which escapes nothing. Remove it, or write two backslashes for one.";
    throw new OptionError(
      `${task}: the value of the \`args\` option, ${JSON.stringify(args)}, ${problem} The binary did not start.`,
    );
  }
}

// Whether `word` names the option `key` as a flag.
function isFlagFor(word: string, key: string): boolean {
  return (
    word === `--${key}` ||
    word.startsWith(`--${key}=`) ||
    word === `--no-${key}` ||
    (key.length === 1 && word === `-${key}`)
  );
}

// The words of a list of arguments before its first `--`, which Nx parses as
// flags; after it every word is positional.
function beforeDoubleDash(words: readonly string[]): readonly string[] {
  const end = words.indexOf("--");
  return end === -1 ? words : words.slice(0, end);
}

// The words of a list that Nx can take as positional: those that are no
// flag, and every word after the first `--`. Some of them may be values of
// flags, which is no matter here: they come from the same command line.
function positionalWords(words: readonly string[]): string[] {
  const end = words.indexOf("--");
  const before = end === -1 ? words : words.slice(0, end);
  return [
    ...before.filter((word) => !word.startsWith("-")),
    ...(end === -1 ? [] : words.slice(end + 1)),
  ];
}

function isWordList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((word) => typeof word === "string");
}

/**
 * The name under which Nx hands a task an option given with dashes, where
 * the executor's schema declares that name (`camelCase` in `utils/params.js`
 * of `nx` 24).
 */
function nxCamelCase(name: string): string {
  return name.indexOf("-") > 1
    ? name.toLowerCase().replace(/-(.)/g, (_match, letter: string) => letter.toUpperCase())
    : name;
}
