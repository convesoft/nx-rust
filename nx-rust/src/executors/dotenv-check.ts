import type { ProjectGraph, Task } from "@nx/devkit";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { nxTaskEnv, runDependentVariables, TaskEnvironmentError } from "./task-env";

/**
 * The version of dotenv-expand whose expansion this module follows: the one
 * that Nx 24.0.6 pins, through which Nx expands a task's dotenv files.
 */
export const followedDotenvExpand = "12.0.3";

/**
 * The longest value that the expansion of this module lets a variable reach
 * at any step: 131,072 characters, the longest single environment string
 * with which Linux starts a process (`MAX_ARG_STRLEN`), so that a variable
 * of reasonable size, one that can reach cargo, never comes near it.
 * dotenv-expand has no limit. This also stops growth that puts in no value,
 * as through `$&` in a default, which `String.prototype.replace` reads as
 * the reference's text.
 */
export const lengthLimit = 131_072;

/**
 * How many steps the check takes at most over all the values that it cannot
 * tell apart for variables that the dotenv files define: a limit of its own
 * knowledge, not of Nx's expansion, which a single expansion reaches only by
 * following that many references.
 */
export const searchLimit = 1_000_000;

/** Why the expansion of this module stopped before it ended. */
export type Stop =
  | { stop: "cycle" }
  | { stop: "nesting"; name: string }
  | { stop: "length" }
  | { stop: "search" };

/** What {@link expandLikeNx} returns when its expansion stops before it ends. */
export const tooComplex = Symbol("too complex");

/** The task that {@link dotenvProblem} checks, as Nx's `getEnvFilesForTask` reads it. */
export type DotenvTask = Pick<Task, "id" | "projectRoot"> & {
  target: { project: string; target: string; configuration?: string };
};

/** A task's dotenv files as dotenv reads them for Nx. */
export interface TaskDotenv {
  /** The paths, relative to the repository root, of the files that exist. */
  existing: string[];
  /** Each variable's value from the first file that defines it, as dotenv merges them. */
  raw: Record<string, string>;
  /** The file that gives each variable of {@link raw}. */
  origin: Map<string, string>;
  /** The files that define `NX_LOAD_DOT_ENV_FILES`. */
  loadSwitches: string[];
  /** The vaults that dotenv would read where `DOTENV_KEY` is set. */
  vaults: string[];
}

/**
 * The dotenv files that Nx loads for `task` and what they define, read with
 * the installed Nx's `getEnvFilesForTask` and dotenv's own parser; files that
 * do not exist are not read.
 *
 * @throws {TaskEnvironmentError} When the installed Nx lacks what it reads.
 */
export function readTaskDotenv(task: DotenvTask, graph: ProjectGraph, root: string): TaskDotenv {
  const { module, file: taskEnvFile } = nxTaskEnv(root);
  const filesOf = module.getEnvFilesForTask;
  if (typeof filesOf !== "function") {
    throw new TaskEnvironmentError(
      "the installed Nx lacks getEnvFilesForTask in nx/src/tasks-runner/task-env",
    );
  }
  let paths: unknown;
  try {
    paths = filesOf(task, graph);
  } catch (error) {
    throw new TaskEnvironmentError(
      `getEnvFilesForTask of the installed Nx fails for ${task.id} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    throw new TaskEnvironmentError(
      `getEnvFilesForTask of the installed Nx gives no list of files for ${task.id}`,
    );
  }
  const existing = (paths as string[]).filter((path) => existsSync(join(root, path)));
  // dotenv reads a vault instead where DOTENV_KEY is set (`_vaultPath`): for
  // the root files that Nx unloads one by one, beside each, whether or not
  // the file exists, and for the task's files, beside the last one that
  // exists.
  const vaults = [
    ...[".env", ".local.env", ".env.local"].map((name) => `${name}.vault`),
    ...(existing.length === 0 ? [] : [`${existing[existing.length - 1]}.vault`]),
  ].filter((path, index, all) => all.indexOf(path) === index && existsSync(join(root, path)));
  const raw: Record<string, string> = {};
  const origin = new Map<string, string>();
  const loadSwitches: string[] = [];
  if (existing.length > 0) {
    const dotenv = nxDependency(taskEnvFile, "dotenv") as { parse?: unknown };
    if (typeof dotenv.parse !== "function") {
      throw new TaskEnvironmentError("the dotenv package of the installed Nx lacks parse");
    }
    const parse = dotenv.parse as (source: string) => Record<string, string>;
    // As dotenv's `config` merges several files: the first that defines a
    // variable gives its value. A file it cannot read, it skips.
    for (const path of existing) {
      let content: string;
      try {
        content = readFileSync(join(root, path), "utf8");
      } catch {
        continue;
      }
      for (const [name, value] of Object.entries(parse(content))) {
        if (name === "NX_LOAD_DOT_ENV_FILES") {
          loadSwitches.push(path);
        }
        if (!origin.has(name)) {
          raw[name] = value;
          origin.set(name, path);
        }
      }
    }
  }
  return { existing, raw, origin, loadSwitches, vaults };
}

/**
 * Every name that one of the dotenv files that Nx loads for `task` defines,
 * in any of them.
 *
 * @throws {TaskEnvironmentError} When the installed Nx lacks what it reads.
 */
export function dotenvDefinitions(task: DotenvTask, graph: ProjectGraph, root: string): string[] {
  return Object.keys(readTaskDotenv(task, graph, root).raw);
}

/**
 * Why a task's dotenv files cannot give cargo the same values in every way of
 * running the task, or `undefined` where they can (`DES-BATCH`, "Dotenv
 * files"). The same check runs for a task run on its own and for a task of a
 * batch, before any cargo command, and reads the files that Nx loads for the
 * task and nothing else; without any, it reads nothing.
 *
 * A vault that dotenv would read because `DOTENV_KEY` is set fails the task
 * first, whether or not a plain file exists beside it and whether or not Nx
 * loads the task's files, since Nx reads the root vaults when it removes the
 * root files' values from the task.
 *
 * Whether Nx loads the files, the `nx` process's `NX_LOAD_DOT_ENV_FILES`
 * decides, which a file that defines the variable could change in the
 * environment that the task ends with: a task whose files define it fails,
 * and otherwise the task's environment has the value that decided.
 *
 * Nx expands the dotenv files of a task run on its own in the `nx` process
 * and a batch expands them in its own process, where the variables of
 * {@link runDependentVariables} can have other values; the plugin checks them
 * in the task's or the batch's process, where they can differ again. Every
 * other variable has the same value in all of these processes. So the
 * expansion gives the same values everywhere unless it looks one of those
 * variables up, which {@link expansionLookup} finds out by following
 * dotenv-expand through every name it looks up, those in the values it
 * substitutes included. A variable of the set that a file only defines
 * changes nothing that cargo sees (see {@link runDependentVariables}).
 *
 * @param env The environment that the plugin gives cargo for the task: the
 *   values that the files gave it, and every other variable as the process
 *   that expanded them had it, apart from those of the set.
 * @throws {TaskEnvironmentError} When the installed Nx lacks what the check
 *   reads.
 */
// @mara implements DES-BATCH
export function dotenvProblem(
  task: DotenvTask,
  graph: ProjectGraph,
  root: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const { existing, raw, origin, loadSwitches, vaults } = readTaskDotenv(task, graph, root);
  const dotenvKey = (env.DOTENV_KEY ?? "") !== "" || (raw.DOTENV_KEY ?? "") !== "";
  if (dotenvKey && vaults.length > 0) {
    return `DOTENV_KEY is set and ${vaults[0]} exists, so Nx reads the task's dotenv variables from that vault, which @convesoft/nx-rust cannot check (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the vault or unset DOTENV_KEY for this command.`;
  }
  if (loadSwitches.length > 0) {
    return `${loadSwitches.join(" and ")} ${loadSwitches.length === 1 ? "defines" : "define"} NX_LOAD_DOT_ENV_FILES, which decides in the nx process whether Nx loads the task's dotenv files at all, while the task's own environment can end with the file's value; @convesoft/nx-rust then cannot tell whether Nx loaded them, nor check them (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the definition of NX_LOAD_DOT_ENV_FILES from ${loadSwitches.join(" and ")}; to switch the loading of dotenv files off, set NX_LOAD_DOT_ENV_FILES=false in the environment of the nx command, in the shell or the CI settings.`;
  }
  // Nx loads dotenv files only then (`getTaskSpecificEnv`); no file defines
  // the variable, so the task's environment has the nx process's value.
  if (existing.length === 0 || env.NX_LOAD_DOT_ENV_FILES !== "true") {
    return undefined;
  }
  if (!Object.values(raw).some((value) => value.includes("$"))) {
    return undefined;
  }
  const version = nxDependencyVersion(nxTaskEnv(root).file, "dotenv-expand");
  if (version !== followedDotenvExpand) {
    const name = Object.keys(raw).find((key) => raw[key].includes("$")) as string;
    return `${origin.get(name)} has a value with $, which the installed Nx expands with dotenv-expand ${version ?? "of an unknown version"}; @convesoft/nx-rust knows how dotenv-expand ${followedDotenvExpand} expands it, and cannot tell whether this expansion gives the same values in a batch as for the task run on its own (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Run the tasks with --batch=false and use an Nx version that @convesoft/nx-rust supports.`;
  }

  const unsafe = (name: string) =>
    Object.prototype.hasOwnProperty.call(runDependentVariables, name);
  // Where Nx expands, a variable that a file defines has the command's value
  // where the command sets it, else the file's, and the plugin cannot tell
  // which in a task's process: it follows every value the variable can have
  // there, the file's, the empty one and the one it ended with.
  const own = (record: NodeJS.ProcessEnv, name: string) =>
    Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined;
  const values = (name: string): (string | undefined)[] =>
    Object.prototype.hasOwnProperty.call(raw, name)
      ? [raw[name], "", own(env, name)]
      : [own(env, name)];
  const longest = Math.max(
    0,
    ...[...Object.values(raw), ...Object.values(env)].map((value) => value?.length ?? 0),
  );
  for (const name in raw) {
    // Its own value never reaches cargo as it is (see runDependentVariables).
    if (unsafe(name)) {
      continue;
    }
    const found = expansionLookup(raw[name], values, unsafe, longest);
    if (typeof found === "object") {
      return `${origin.get(name)}: ${stopMessage(name, found)} (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it.`;
    }
    if (found !== undefined) {
      return `${origin.get(name)} makes Nx look up ${found} where it expands ${name}, and ${found} has a value there that depends on how the task runs: ${runDependentVariables[found]}. The task would get other values alone than in a batch, or in another output style, under one cache key (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the reference to ${found} from ${name}.`;
    }
  }
  return undefined;
}

// Why the check stopped following `name`, and what to do.
function stopMessage(name: string, stop: Stop): string {
  switch (stop.stop) {
    case "cycle":
      return `Nx's expansion of ${name} does not end: it comes back to a value and set of earlier values that it had before, from which dotenv-expand repeats the same steps without end. Change the references in ${name}, or in the variables that it refers to, that refer back to themselves`;
    case "nesting":
      return `Nx's expansion of ${name} does not end: the value of ${stop.name} is put in again inside the text that putting it in gave, ${nestingLimit} times over, as where a variable refers to itself with text around the reference, and dotenv-expand goes on doing so without end. Change the references in ${name}, or in the variables that it refers to, that refer back to themselves`;
    case "length":
      return `Nx's expansion of ${name} grows beyond ${lengthLimit} characters, longer than one environment variable with which Linux starts a process, as a variable that refers to itself with text around the reference makes it grow without end. Change the references in ${name}, or in the variables that it refers to, that refer back to themselves`;
    case "search":
      return `@convesoft/nx-rust's check of the dotenv files gives up on ${name} after ${searchLimit} steps, its own limit for following the values that it cannot tell apart for the variables that the dotenv files define and that the command's environment could set, so it cannot tell whether Nx's expansion of ${name} gives the same value in every way of running the task. Refer in ${name} to fewer variables that the dotenv files define and that hold references themselves`;
  }
}

/** A reference that dotenv-expand 12.0.3 finds in a value (`expandValue`). */
interface Reference {
  /** The reference as it stands in the value. */
  template: string;
  /** Where it starts in the value. */
  index: number;
  /** The name it looks up. */
  key: string;
  /** Its operator, `:+`, `+`, `:-` or `-`, or `null`. */
  splitter: string | null;
  /** What follows the operator: the default or the alternative. */
  rest: string;
}

// The leftmost reference in `result`, `${…}` or `$NAME` not preceded by a
// backslash, with the name before the first operator. dotenv-expand splits
// and joins with null where there is no operator, which JavaScript turns into
// the separator "null"; so does this.
function leftmostReference(result: string): Reference | undefined {
  const match = /(?<!\\)\${([^{}]+)}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/.exec(result);
  if (match === null) {
    return undefined;
  }
  const [template, braced, unbraced] = match;
  const expression = braced || unbraced;
  const splitter = expression.match(/(:\+|\+|:-|-)/)?.[0] ?? null;
  const parts = expression.split(splitter as string);
  const key = parts.shift() as string;
  return { template, index: match.index, key, splitter, rest: parts.join(splitter as string) };
}

// What dotenv-expand puts in place of `reference` when its name has `value`:
// for `:+` and `+` the alternative where the value is not empty; otherwise
// the value, unless it is empty or a result already seen, and else the
// default. The value goes to `String.prototype.replace` as dotenv-expand
// gives it.
function replacementOf(reference: Reference, value: unknown, blocked: boolean): string {
  if (reference.splitter === ":+" || reference.splitter === "+") {
    return value ? reference.rest : "";
  }
  return (value && !blocked ? value : reference.rest) as string;
}

/**
 * Brent's detection of a cycle in the states of one expansion, with one
 * remembered state. dotenv-expand's next step depends only on the result and
 * the set of earlier results (with the environment, the values that it gave
 * earlier and, in the search, the values chosen, all fixed along a path); the
 * set only grows, so two states with the same result, the same number of
 * earlier results and the same choices are the same state, from which
 * dotenv-expand repeats the same steps without end. A finite expansion never
 * comes back to a state, so this stops none.
 */
interface Brent {
  saved: string;
  power: number;
  steps: number;
}

// A detector that has seen nothing yet.
function fresh(): Brent {
  return { saved: "\u0003", power: 1, steps: 0 };
}

// The detector after a step to `state`, or "cycle" where it came back.
function brentStep(brent: Brent, state: string): Brent | "cycle" {
  if (state === brent.saved) {
    return "cycle";
  }
  const steps = brent.steps + 1;
  return steps === brent.power
    ? { saved: state, power: brent.power * 2, steps: 0 }
    : { ...brent, steps };
}

/**
 * How often one name's value may be put in inside the text that earlier
 * insertions of its own value gave, along one chain of nested
 * substitutions, before the check takes the expansion as one that does not
 * end. A repetition, as a list of references to one variable, nests nothing;
 * an expansion that does not end puts values in without end, along a chain
 * on which, with finitely many names, one name comes back each round, so it
 * reaches this in as many rounds. A finite expansion nests a name inside its
 * own value only where dotenv-expand's guards end it after a few rounds: a
 * value equal to an earlier whole result, or a result equal to a value it
 * gave earlier, which a value nested many times inside copies of itself
 * cannot equal.
 */
export const nestingLimit = 64;

/** A text that a value put in became, with the names that put in its chain. */
interface Region {
  start: number;
  end: number;
  names: readonly string[];
}

// The regions after [start, end) became `length` characters: those before
// stay, those after move, those around grow or shrink, and those inside or
// across go with the text replaced.
function movedRegions(
  regions: readonly Region[],
  start: number,
  end: number,
  length: number,
): Region[] {
  const delta = length - (end - start);
  const moved: Region[] = [];
  for (const region of regions) {
    if (region.end <= start) {
      moved.push(region);
    } else if (region.start >= end) {
      moved.push({ ...region, start: region.start + delta, end: region.end + delta });
    } else if (region.start <= start && region.end >= end) {
      moved.push({ ...region, end: region.end + delta });
    }
  }
  return moved;
}

/**
 * One step of dotenv-expand: `text` put in for `reference` with
 * `String.prototype.replace`, which puts it at the first occurrence of the
 * reference's text, an earlier escaped copy included, and reads `$$`, `$&`
 * and the like in it; with the regions of values put in moved, the region of
 * this one added where it is the name's value and holds a `$`, and how often
 * the name now stands in its own chain.
 */
function stepped(
  result: string,
  reference: Reference,
  text: string,
  inserted: boolean,
  regions: readonly Region[],
): { result: string; regions: Region[]; nesting: number } {
  const start = result.indexOf(reference.template);
  const end = start + reference.template.length;
  const next = result.replace(reference.template, text);
  const length = next.length - (result.length - reference.template.length);
  const enclosing = regions
    .filter((region) => region.start < end && region.end > start)
    .flatMap((region) => region.names);
  const moved = movedRegions(regions, start, end, length);
  const holds = inserted && next.slice(start, start + length).includes("$");
  const names = holds ? [...new Set(enclosing), reference.key] : [];
  if (holds) {
    moved.push({ start, end: start + length, names });
  }
  return {
    result: next,
    regions: moved,
    nesting: holds ? enclosing.filter((name) => name === reference.key).length + 1 : 0,
  };
}

// A placeholder for one of several texts without a reference, which the
// search puts in where the choice changes no reference that it finds later.
const placeholder = /\uE000(\d+)\uE001/g;

// Whether text put in at `index` of `result` could become part of a
// reference: right after an unescaped `$`, or inside a `${` that is not
// closed and holds no brace.
function joinsReference(result: string, index: number): boolean {
  const before = result.slice(0, index);
  if (before.endsWith("$") && !before.endsWith("\\$")) {
    return true;
  }
  for (
    let open = before.lastIndexOf("${");
    open !== -1;
    open = before.lastIndexOf("${", open - 1)
  ) {
    if (open > 0 && before[open - 1] === "\\") {
      continue;
    }
    return !/[{}]/.test(before.slice(open + 2));
  }
  return false;
}

/**
 * The first name for which `unsafe` holds that dotenv-expand 12.0.3
 * (`expandValue` of `lib/main.js`) looks up while it expands `raw`, a
 * {@link Stop} where the expansion comes back to a state it was in, grows
 * beyond {@link lengthLimit} characters or takes the check beyond
 * {@link searchLimit} steps, or `undefined` where it looks none up.
 *
 * It follows dotenv-expand step by step, with the steps of
 * {@link expandLikeNx}: the leftmost reference, the value or the default put
 * in with `String.prototype.replace`, and the search again from the start,
 * so that a reference that a substituted value brings or that the
 * replacement assembles is looked up too. Where `values` gives a name several
 * possible values, it follows each, and keeps the one it took for that name
 * until the expansion ends, as a name has one value in dotenv-expand's
 * environment. Where every value would put in a text without `$`, at a place
 * where the text cannot become part of a reference and where the result has
 * no earlier escaped copy of the reference, it follows one path with a
 * placeholder for those texts, which it puts back with each text where a
 * later step could join it to a reference. Only a value with a reference can
 * equal an earlier whole result, which every reference that dotenv-expand
 * found holds, so a value is blocked exactly where it equals an earlier
 * result, and possibly where it equals an earlier result with a
 * placeholder, which the search then follows both ways. It never stops early
 * where dotenv-expand stops because the result equals a value it gave
 * earlier, which can only find more names.
 *
 * @param values Every value that a name can have where Nx expands the files,
 *   `undefined` for none.
 * @param longest The longest value that a name can have: a longer result can
 *   equal none, and is not kept.
 */
export function expansionLookup(
  raw: string,
  values: (name: string) => readonly (string | undefined)[],
  unsafe: (name: string) => boolean,
  longest = lengthLimit,
): string | Stop | undefined {
  // The results seen on a path, newest first, with a digest of the chain.
  interface Seen {
    result: string;
    parent: Seen | undefined;
    size: number;
    digest: string;
    // For a result with a placeholder, its parts and the lengths it can
    // have, worked out when first needed.
    shape?: { parts: string[]; shortest: number; longest: number };
  }
  interface Pending {
    result: string;
    seen: Seen | undefined;
    chosen: ReadonlyMap<string, string | undefined>;
    choices: string;
    brent: Brent;
    regions: readonly Region[];
  }
  const texts = new Map<string, readonly string[]>();
  const ids = new Map<string, string>();
  const digest = (...parts: string[]) =>
    createHash("sha1").update(parts.join("\0")).digest("base64");
  // Whether `value` equals the result of `link` with each placeholder one
  // of its texts: first by length, then part by part.
  const matches = (link: Seen, value: string): boolean => {
    if (link.shape === undefined) {
      const parts = link.result.split(placeholder);
      let least = 0;
      let most = 0;
      for (const [index, part] of parts.entries()) {
        const options = index % 2 === 0 ? [part] : (texts.get(part) ?? []);
        least += Math.min(...options.map((option) => option.length));
        most += Math.max(...options.map((option) => option.length));
      }
      link.shape = { parts, shortest: least, longest: most };
    }
    const { parts } = link.shape;
    if (value.length < link.shape.shortest || value.length > link.shape.longest) {
      return false;
    }
    let positions = new Set([0]);
    for (const [index, part] of parts.entries()) {
      const options = index % 2 === 0 ? [part] : (texts.get(part) ?? []);
      const next = new Set<number>();
      for (const position of positions) {
        for (const option of options) {
          if (value.startsWith(option, position)) {
            next.add(position + option.length);
          }
        }
      }
      if (next.size === 0) {
        return false;
      }
      positions = next;
    }
    return positions.has(value.length);
  };
  // Whether `value` equals an earlier result: "yes", "no", or "maybe" where
  // it equals one with a placeholder for one of its texts.
  const blocked = (seen: Seen | undefined, value: unknown): "yes" | "no" | "maybe" => {
    if (typeof value !== "string" || !value.includes("$")) {
      return "no";
    }
    let maybe = false;
    for (let link = seen; link !== undefined; link = link.parent) {
      if (!link.result.includes("\uE000")) {
        if (link.result === value) {
          return "yes";
        }
      } else if (!maybe) {
        maybe = matches(link, value);
      }
    }
    return maybe ? "maybe" : "no";
  };
  // The length that a result can have at most, and at least, with each
  // placeholder one of its texts.
  const lengthWith = (result: string, pick: (lengths: number[]) => number) =>
    result.replace(placeholder, (_, id: string) =>
      "x".repeat(pick((texts.get(id) ?? [""]).map((text) => text.length))),
    ).length;
  const length = (result: string) => lengthWith(result, (lengths) => Math.max(0, ...lengths));
  const shortest = (result: string) =>
    lengthWith(result, (lengths) => Math.min(...lengths, Number.MAX_SAFE_INTEGER));

  const pending: Pending[] = [
    {
      result: raw,
      seen: undefined,
      chosen: new Map(),
      choices: "",
      brent: fresh(),
      regions: [],
    },
  ];
  const visited = new Set<string>();
  let steps = 0;
  // A path alone cannot meet itself again, where Brent's detector watches
  // it; only where several paths are open can two reach the same state.
  const push = (state: Pending): Stop | undefined => {
    const brent = brentStep(
      state.brent,
      `${state.result}\0${state.seen?.size ?? 0}\0${state.choices}`,
    );
    if (brent === "cycle") {
      return { stop: "cycle" };
    }
    if (pending.length > 0) {
      const key = digest(state.result, state.seen?.digest ?? "", state.choices);
      if (visited.has(key)) {
        return undefined;
      }
      visited.add(key);
    }
    pending.push({ ...state, brent });
    return undefined;
  };
  while (pending.length > 0) {
    const state = pending.pop() as Pending;
    const { result, seen, chosen, choices } = state;
    // A placeholder that a later step put where it could join a reference
    // goes back to its texts first.
    let joined: RegExpExecArray | undefined;
    for (const found of result.matchAll(placeholder)) {
      if (joinsReference(result, found.index)) {
        joined = found as RegExpExecArray;
        break;
      }
    }
    if (joined !== undefined) {
      if (++steps > searchLimit) {
        return { stop: "search" };
      }
      for (const text of texts.get(joined[1]) ?? []) {
        const next =
          result.slice(0, joined.index) + text + result.slice(joined.index + joined[0].length);
        const stop = push({
          ...state,
          result: next,
          regions: movedRegions(
            state.regions,
            joined.index,
            joined.index + joined[0].length,
            text.length,
          ),
        });
        if (stop !== undefined) {
          return stop;
        }
      }
      continue;
    }
    const reference = leftmostReference(result);
    if (reference === undefined) {
      continue;
    }
    if (++steps > searchLimit) {
      return { stop: "search" };
    }
    if (unsafe(reference.key)) {
      return reference.key;
    }
    // Hashed only where a state is kept for paths that may meet, and once.
    // A result longer than every value can equal none, and is not kept; nor
    // is one kept already, as dotenv-expand's `seen` is a set.
    let chain: string | undefined;
    let held = false;
    for (let link = seen; link !== undefined && !held; link = link.parent) {
      held = link.result === result;
    }
    const now: Seen | undefined =
      held || shortest(result) > longest
        ? seen
        : {
            result,
            parent: seen,
            size: (seen?.size ?? 0) + 1,
            get digest(): string {
              chain ??= digest(seen?.digest ?? "", result);
              return chain;
            },
          };
    const known = chosen.has(reference.key);
    const candidates = known ? [chosen.get(reference.key)] : [...new Set(values(reference.key))];
    // What each value of the name would put in.
    const outcomes = candidates.flatMap((value) => {
      const block = blocked(now, value);
      const ways = block === "maybe" ? [false, true] : [block === "yes"];
      return ways.map((way) => ({
        value,
        text: replacementOf(reference, value, way),
        inserted:
          reference.splitter !== ":+" && reference.splitter !== "+" && Boolean(value) && !way,
      }));
    });
    const distinct = new Set(outcomes.map((outcome) => outcome.text));
    const start = reference.index;
    // A text without `$` goes in as it is, where the reference stands, where
    // the result has no earlier escaped copy of the reference's text.
    if (
      distinct.size > 1 &&
      result.indexOf(reference.template) === start &&
      [...distinct].every((text) => !text.includes("$")) &&
      !joinsReference(result, start)
    ) {
      const set = [...distinct].sort();
      const id = ids.get(set.join("\0")) ?? String(texts.size);
      ids.set(set.join("\0"), id);
      texts.set(id, set);
      const next =
        result.slice(0, start) +
        `\uE000${id}\uE001` +
        result.slice(start + reference.template.length);
      if (length(next) > lengthLimit) {
        return { stop: "length" };
      }
      const stop = push({
        ...state,
        result: next,
        seen: now,
        regions: movedRegions(
          state.regions,
          start,
          start + reference.template.length,
          next.length - (result.length - reference.template.length),
        ),
      });
      if (stop !== undefined) {
        return stop;
      }
      continue;
    }
    const followed = new Set<string>();
    for (const { value, text, inserted } of outcomes) {
      if (followed.has(`${value}\0${text}\0${inserted}`)) {
        continue;
      }
      followed.add(`${value}\0${text}\0${inserted}`);
      const step = stepped(result, reference, text, inserted, state.regions);
      if (step.nesting > nestingLimit) {
        return { stop: "nesting", name: reference.key };
      }
      if (length(step.result) > lengthLimit) {
        return { stop: "length" };
      }
      const branch = known || candidates.length === 1;
      const stop = push({
        result: step.result,
        seen: now,
        chosen: branch ? chosen : new Map(chosen).set(reference.key, value),
        choices: branch ? choices : `${choices}\0${reference.key}=${value ?? "\u0001"}`,
        brent: state.brent,
        regions: step.regions,
      });
      if (stop !== undefined) {
        return stop;
      }
    }
  }
  return undefined;
}

/**
 * The values that dotenv-expand 12.0.3's `expand` gives the variables of
 * `parsed` over `processEnv`, the environment that dotenv's `config` left,
 * exactly as Nx's loader takes them, or {@link tooComplex} where one
 * expansion comes back to a state it was in or grows beyond
 * {@link lengthLimit} characters, where dotenv-expand does not end or holds a
 * value longer than Linux starts a process with. It shares the steps of
 * {@link expansionLookup}, against which the tests compare it with the
 * library itself.
 */
export function expandLikeNx(
  parsed: Record<string, string>,
  processEnv: NodeJS.ProcessEnv,
): Record<string, string> | typeof tooComplex {
  const runningParsed: Record<string, string> = {};
  const expanded: Record<string, string> = {};
  for (const key in parsed) {
    let value: string | typeof tooComplex = parsed[key];
    const current = processEnv[key];
    if (current && current !== value) {
      value = current;
    } else {
      value = expandValueLikeNx(value, processEnv, runningParsed);
      if (value === tooComplex) {
        return tooComplex;
      }
    }
    expanded[key] = value.replace(/\\\$/g, "$");
    runningParsed[key] = expanded[key];
  }
  return expanded;
}

// dotenv-expand 12.0.3's `expandValue`, step for step. Only a result with a
// reference goes into `seen`, so only a value with a reference can equal
// one; a result longer than every value equals none, and is not kept.
function expandValueLikeNx(
  value: string,
  processEnv: NodeJS.ProcessEnv,
  runningParsed: Record<string, string>,
): string | typeof tooComplex {
  const env: NodeJS.ProcessEnv = { ...runningParsed, ...processEnv };
  const longest = Math.max(
    0,
    ...[...Object.values(processEnv), ...Object.values(runningParsed)].map((entry) =>
      typeof entry === "string" ? entry.length : 0,
    ),
  );
  const seen = new Set<string>();
  let brent = fresh();
  let regions: Region[] = [];
  let result = value;
  for (
    let reference = leftmostReference(result);
    reference !== undefined;
    reference = leftmostReference(result)
  ) {
    if (result.length <= longest) {
      seen.add(result);
    }
    const found = env[reference.key];
    if (found !== undefined && typeof found !== "string") {
      // A name of Object's prototype, whose function dotenv-expand hands
      // String.prototype.replace, which then leaves the result as it was or
      // throws.
      return tooComplex;
    }
    const blockedValue = found !== undefined && seen.has(found);
    const step = stepped(
      result,
      reference,
      replacementOf(reference, found, blockedValue),
      reference.splitter !== ":+" && reference.splitter !== "+" && Boolean(found) && !blockedValue,
      regions,
    );
    result = step.result;
    regions = step.regions;
    const next = brentStep(brent, `${result}\0${seen.size}`);
    if (next === "cycle" || step.nesting > nestingLimit || result.length > lengthLimit) {
      return tooComplex;
    }
    brent = next;
    if (result === runningParsed[reference.key]) {
      break;
    }
  }
  return result;
}

// A dependency of the installed Nx, as Nx itself loads it.
export function nxDependency(nxFile: string, name: string): Record<string, unknown> {
  try {
    return require(require.resolve(name, { paths: [dirname(nxFile)] }));
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    throw new TaskEnvironmentError(`${name} of the installed Nx cannot be loaded (${reason})`);
  }
}

// The version of a dependency of the installed Nx, or undefined.
function nxDependencyVersion(nxFile: string, name: string): string | undefined {
  try {
    const manifest = require(require.resolve(`${name}/package.json`, { paths: [dirname(nxFile)] }));
    return typeof manifest?.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}
