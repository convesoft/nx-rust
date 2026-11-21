import type { ProjectGraph, Task } from "@nx/devkit";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNxDependency, loadTaskEnv, NxBridgeError } from "../compatibility/nx-bridge";
import {
  rootDotenvFiles,
  runDependentVariables,
  TaskEnvironmentError,
  toTaskEnvironmentError,
} from "./task-env";

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
  let loaded: ReturnType<typeof loadTaskEnv<"getEnvFilesForTask">>;
  try {
    loaded = loadTaskEnv(root, ["getEnvFilesForTask"]);
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskEnvironmentError(error);
    }
    throw error;
  }
  const { getEnvFilesForTask: filesOf, file: taskEnvFile } = loaded;
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
    ...rootDotenvFiles.map((name) => `${name}.vault`),
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
 * Why a task's dotenv files cannot be shown to give cargo the same values in
 * every way of running the task, or `undefined` where they can (`DES-BATCH`,
 * "Dotenv files"). The same check runs for a task run on its own and for a
 * task of a batch, before any cargo command, and reads the files that Nx loads
 * for the task and nothing else; without any, it reads nothing.
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
 * other variable has the same value in all of these processes. From every
 * variable that the files define and that is not in
 * {@link runDependentVariables}, the check walks `$VAR`, `${VAR...}` and
 * `$$VAR` references statically as the installed `dotenv-expand` matches,
 * splits (including `split(null)` on `"null"`), escapes (`(?<!\\)`), and
 * replaces them, through the raw definitions and the values in `env` of every
 * variable reached, following both branches of every `:-`, `-`, `:+` and `+`
 * with a visited set for cycles, and fails the task where a variable of
 * {@link runDependentVariables} is reached or where a value holds a form from
 * which a variable name could be assembled. A source-text tripwire test guards
 * those `dotenv-expand` behaviours instead of a run-time version pin.
 * Diagnostics never include text from any variable's value.
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

  for (const name of Object.keys(raw)) {
    // Its own value never reaches cargo as it is (see runDependentVariables).
    if (isRunDependent(name) || !raw[name].includes("$")) {
      continue;
    }
    const found = findUnsafeReference(raw[name], raw, env);
    if (found === undefined) {
      continue;
    }
    if (found.kind === "run-dependent") {
      return `${origin.get(name)} makes Nx look up ${found.lookup} where it expands ${name}, and ${found.lookup} has a value there that depends on how the task runs: ${runDependentVariables[found.lookup]}. The task would get other values alone than in a batch, or in another output style, under one cache key (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the reference to ${found.lookup} from ${name}.`;
    }
    const via = found.via !== undefined ? ` (via ${found.via})` : "";
    return `${origin.get(name)} expands ${name}${via} through ${ambiguousReasonText[found.reason]}, from which @convesoft/nx-rust cannot tell statically which variables Nx looks up (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Use plain $NAME or \${NAME} references with static variable names, brace unbraced references before following text, or escape literal $ as \\$.`;
  }
  return undefined;
}

type AmbiguousReason =
  | "unclosed-braced"
  | "dynamic-braced"
  | "assembled-dollar"
  | "unbraced-join"
  | "trailing-dollar"
  | "replace-pattern";

const ambiguousReasonText: Readonly<Record<AmbiguousReason, string>> = {
  "unclosed-braced": "an unclosed ${...} reference",
  "dynamic-braced": "a ${...} reference whose variable name is assembled dynamically",
  "assembled-dollar": "a $$ reference that can assemble a variable name dynamically",
  "unbraced-join": "an unbraced $ reference that can join adjacent text",
  "trailing-dollar": "a trailing $ that can join adjacent text",
  "replace-pattern": "a $ replacement pattern in a referenced value or default",
};

type StaticFinding =
  | { kind: "run-dependent"; lookup: string }
  | { kind: "ambiguous"; reason: AmbiguousReason; via?: string };

interface SiteContext {
  /** Whether text substituted here can immediately precede `[A-Za-z0-9_]`. */
  followedByIdent: boolean;
  /** Whether text substituted here can immediately precede `[A-Za-z_{$]`. */
  followedByRefStart: boolean;
  /**
   * Whether an escaped `\$` appeared earlier in an enclosing value, so
   * `String.prototype.replace` can substitute any matched reference into that
   * earlier escaped site regardless of what follows it here.
   */
  afterEscapedDollar: boolean;
}

interface ScannedReference {
  key: string;
  op: string | null;
  rest: string;
  /**
   * True when the reference is preceded by a literal `$` (`$$NAME`), so
   * `dotenv-expand` leaves that `$` in place and re-scans `$<value of key>`
   * on the next pass.
   */
  doubleDollar: boolean;
  /** Context immediately after the reference (or an earlier escaped copy). */
  site: SiteContext;
}

const identStart = /[A-Za-z_]/;
const identChar = /[A-Za-z0-9_]/;
const identFull = /^[A-Za-z_][A-Za-z0-9_]*$/;
const refStartChar = /[A-Za-z_{$]/;
const leadingIdent = /^([A-Za-z_][A-Za-z0-9_]*)/;
// The exact token pattern of `dotenv-expand` (`lib/main.js`, `expandValue`).
const dotenvExpandToken = /(?<!\\)\${([^{}]+)}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/;

function isRunDependent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(runDependentVariables, name);
}

function ownValue(record: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined;
}

function candidateValues(
  key: string,
  raw: Record<string, string>,
  env: NodeJS.ProcessEnv,
): (string | undefined)[] {
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? [raw[key], ownValue(env, key)]
    : [ownValue(env, key)];
}

/**
 * Walks all variable references reachable from `initial`, following both the
 * raw definitions in `raw` and the ambient values in `env` of every reached
 * variable (and both branches of `:-`, `-`, `:+` and `+`), with a visited set
 * keyed by `(name, followedByIdent, followedByRefStart)` so cycles terminate
 * without rejecting self-references such as `RUSTFLAGS=${RUSTFLAGS} ...`
 * (`DES-BATCH`, "Dotenv files").
 */
function findUnsafeReference(
  initial: string,
  raw: Record<string, string>,
  env: NodeJS.ProcessEnv,
): StaticFinding | undefined {
  const visited = new Set<string>();

  const walkKey = (
    key: string,
    site: SiteContext,
    viaName: string | undefined,
  ): StaticFinding | undefined => {
    if (key === "") {
      return undefined;
    }
    if (isRunDependent(key)) {
      return { kind: "run-dependent", lookup: key };
    }
    const visitKey = `${key}\0${site.followedByIdent ? "1" : "0"}${site.followedByRefStart ? "1" : "0"}${site.afterEscapedDollar ? "1" : "0"}`;
    if (visited.has(visitKey)) {
      return undefined;
    }
    visited.add(visitKey);
    for (const candidate of candidateValues(key, raw, env)) {
      if (typeof candidate === "string" && candidate.includes("$")) {
        const found = walk(candidate, true, site, viaName);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return undefined;
  };

  /**
   * Checks what `$$key` can assemble when `dotenv-expand` leaves the first `$`
   * in place and substitutes `key`'s value in place of `$key`, producing
   * `$<value>` followed by `site`:
   * - If `key` can hold `$`, or starts with `{`, it can assemble arbitrary
   *   references: refuse statically.
   * - If `key` can be empty/unset and `site.followedByRefStart` holds, the
   *   surviving `$` meets the following text (e.g. `$$UNSET{FORCE_COLOR}`):
   *   refuse statically.
   * - If a candidate value starts with `[A-Za-z_]`, `$<value>` looks up the
   *   leading identifier; refuse if it can join following identifier text, or
   *   follow that target variable statically (refusing if run-dependent).
   */
  const checkDoubleDollarTarget = (
    key: string,
    site: SiteContext,
    viaName: string | undefined,
  ): StaticFinding | undefined => {
    const inRaw = Object.prototype.hasOwnProperty.call(raw, key);
    const values = inRaw ? [...candidateValues(key, raw, env), ""] : candidateValues(key, raw, env);
    for (const candidate of values) {
      if (candidate === undefined || candidate === "") {
        if (site.followedByRefStart) {
          return { kind: "ambiguous", reason: "assembled-dollar", via: viaName };
        }
        continue;
      }
      if (candidate.includes("$") || candidate.startsWith("{")) {
        return { kind: "ambiguous", reason: "assembled-dollar", via: viaName };
      }
      const match = leadingIdent.exec(candidate);
      if (match === null) {
        continue;
      }
      const target = match[1];
      if (target.length === candidate.length && site.followedByIdent) {
        return { kind: "ambiguous", reason: "unbraced-join", via: viaName };
      }
      const afterTarget = candidate[target.length];
      const targetSite: SiteContext =
        afterTarget !== undefined
          ? {
              followedByIdent: false,
              followedByRefStart: refStartChar.test(afterTarget),
              afterEscapedDollar: site.afterEscapedDollar,
            }
          : site;
      // Do not pass the assembled target name as `via` so a diagnostic never
      // echoes text that came from a variable's value.
      const found = walkKey(target, targetSite, viaName);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };

  const walk = (
    value: string,
    isSubstituted: boolean,
    site: SiteContext,
    viaName: string | undefined,
  ): StaticFinding | undefined => {
    const scanned = scanReferences(value, isSubstituted, site);
    if (scanned.ambiguous !== undefined) {
      return { kind: "ambiguous", reason: scanned.ambiguous, via: viaName };
    }
    for (const ref of scanned.references) {
      if (ref.key !== "" && isRunDependent(ref.key)) {
        return { kind: "run-dependent", lookup: ref.key };
      }
      // Only a clean identifier reference written directly in a dotenv file
      // (never extracted from an ambient or substituted value) may appear as
      // `via` in a diagnostic.
      const nextVia = !isSubstituted && identFull.test(ref.key) ? ref.key : viaName;
      if (ref.doubleDollar) {
        // When `$$NAME` is expanded directly, the first `$` stays and
        // `$<value of NAME>` is re-scanned; when substituted via
        // `String.prototype.replace`, `$$` collapses to `$` and `$NAME` is
        // looked up. Check both.
        const assembled = checkDoubleDollarTarget(ref.key, ref.site, nextVia);
        if (assembled !== undefined) {
          return assembled;
        }
        const direct = walkKey(ref.key, ref.site, nextVia);
        if (direct !== undefined) {
          return direct;
        }
      } else if (ref.op !== ":+" && ref.op !== "+") {
        // `:+` and `+` only test whether `ref.key` is set; they never
        // substitute its value into the output.
        const found = walkKey(ref.key, ref.site, nextVia);
        if (found !== undefined) {
          return found;
        }
      }
      // The body of a default or alternative is substituted into the enclosing
      // string at the same position as the reference itself.
      if (ref.rest.includes("$")) {
        const found = walk(ref.rest, true, ref.site, nextVia);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return undefined;
  };

  return walk(
    initial,
    false,
    { followedByIdent: false, followedByRefStart: false, afterEscapedDollar: false },
    undefined,
  );
}

/**
 * Whether `value` contains a JavaScript `String.prototype.replace` special
 * pattern (`$&`, `$'` or `` $` ``) that `replace` interprets even after a
 * backslash (`\$&`). An even run of `$`s (such as `$$&`) collapses to literal
 * `$`s rather than a pattern; an odd run triggers the pattern.
 */
function hasReplaceSpecialPattern(value: string): boolean {
  let i = 0;
  while (i < value.length) {
    if (value[i] !== "$") {
      i += 1;
      continue;
    }
    let k = i;
    while (k < value.length && value[k] === "$") {
      k += 1;
    }
    const after = value[k];
    if ((k - i) % 2 === 1 && (after === "&" || after === "'" || after === "`")) {
      return true;
    }
    i = k;
  }
  return false;
}

/**
 * Scans `value` as the installed `dotenv-expand` (`lib/main.js`, `expandValue`)
 * matches, splits and replaces references:
 *
 * - Any `$` immediately preceded by `\` (`(?<!\\)`) is not matched by
 *   `dotenv-expand`. However, `String.prototype.replace` replaces the first
 *   literal occurrence of a matched reference template — an earlier escaped
 *   copy included (`\$NAMEEXECUTOR $NAME`) — so any matched reference after an
 *   earlier escaped `\$` conservatively inherits joinable site context.
 * - Inside a referenced value or default (`isSubstituted`), JavaScript
 *   `String.prototype.replace` interprets `$&`, `$'` and `` $` `` even after
 *   `\`, so those patterns are rejected before skipping escaped dollars.
 * - Braced `${...}` bodies are split with `dotenv-expand`'s own operator match
 *   `/(:\+|\+|:-|-)/` and `expression.split(splitter)` (which splits on the
 *   literal text `"null"` when no operator matches, matching
 *   `${NX_FORKED_TASK_EXECUTORnull}` and `${SET:?error}`). A key containing
 *   `$`, `{` or `}` is rejected as dynamic assembly.
 * - Empty `${}` and unclosed `${` are plain text at top level unless a matched
 *   reference follows an unclosed `${` (which could supply `}`, as in
 *   `${FORCE_${PART}` with `PART=COLOR}`); inside a referenced value or
 *   default they are rejected as stray `$` forms.
 * - `$$` followed by `{` or a third `$` before an identifier is rejected as
 *   dynamic assembly; `$$NAME` records a `doubleDollar` reference so the
 *   walker checks what `$<value of NAME>` can assemble; trailing `$$` or `$`
 *   in a substituted value is rejected only when the substitution site can
 *   precede `[A-Za-z_{$]`; `$$!` or `$!` passes.
 * - An unbraced `$IDENT` or `$$IDENT` at the end of a substituted value (or
 *   default/alternative body) where the substitution site can precede
 *   `[A-Za-z0-9_]` is rejected because substitution could extend the
 *   identifier into another variable name.
 */
function scanReferences(
  value: string,
  isSubstituted: boolean,
  outerSite: SiteContext,
): { references: ScannedReference[]; ambiguous?: AmbiguousReason } {
  const references: ScannedReference[] = [];
  if (isSubstituted && hasReplaceSpecialPattern(value)) {
    return { references, ambiguous: "replace-pattern" };
  }

  let hasEarlierEscapedDollar = outerSite.afterEscapedDollar;
  const siteAt = (index: number): SiteContext => {
    const after = value[index];
    const local: SiteContext =
      after !== undefined
        ? {
            followedByIdent: identChar.test(after),
            followedByRefStart: refStartChar.test(after),
            afterEscapedDollar: hasEarlierEscapedDollar,
          }
        : {
            followedByIdent: outerSite.followedByIdent,
            followedByRefStart: outerSite.followedByRefStart,
            afterEscapedDollar: hasEarlierEscapedDollar,
          };
    // If an escaped `\$` appeared earlier in `value` (or an enclosing value),
    // `String.prototype.replace` can substitute into that earlier escaped
    // occurrence, where identifier or brace text may follow it.
    return hasEarlierEscapedDollar
      ? { followedByIdent: true, followedByRefStart: true, afterEscapedDollar: true }
      : local;
  };

  let i = 0;
  while (i < value.length) {
    if (value[i] !== "$") {
      i += 1;
      continue;
    }
    // `dotenv-expand`'s regex uses `(?<!\\)`: any `$` immediately preceded by
    // `\` is skipped by matching (including `\\$`).
    if (i > 0 && value[i - 1] === "\\") {
      hasEarlierEscapedDollar = true;
      i += 1;
      continue;
    }
    const next = value[i + 1];
    if (next === "{") {
      if (value[i + 2] === "}") {
        if (isSubstituted) {
          return { references, ambiguous: "dynamic-braced" };
        }
        // `dotenv-expand`'s `\${([^{}]+)}` requires at least one character; at
        // top level `${}` is plain text.
        i += 3;
        continue;
      }
      let depth = 1;
      let j = i + 2;
      while (j < value.length && depth > 0) {
        if (value[j] === "{") {
          depth += 1;
        } else if (value[j] === "}") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        j += 1;
      }
      if (depth !== 0) {
        if (isSubstituted) {
          return { references, ambiguous: "unclosed-braced" };
        }
        // At top level, an unclosed `${` is plain text unless a matched
        // reference appears after it (which could supply `}` and close `${`,
        // as in `${FORCE_${PART}` with `PART=COLOR}`).
        if (dotenvExpandToken.test(value.slice(i + 2))) {
          return { references, ambiguous: "dynamic-braced" };
        }
        i += 2;
        continue;
      }
      const expression = value.slice(i + 2, j);
      // Match `dotenv-expand` (`lib/main.js`, `expandValue`) exactly: when no
      // operator matches, `splitter` is `null`, which `String.prototype.split`
      // and `Array.prototype.join` coerce to `"null"`.
      const opMatch = /(:\+|\+|:-|-)/.exec(expression);
      const splitter = opMatch ? opMatch[0] : null;
      const parts = expression.split(splitter as unknown as string);
      const key = parts.shift() as string;
      const rest = parts.join(splitter as unknown as string);
      if (/[${}]/.test(key)) {
        return { references, ambiguous: "dynamic-braced" };
      }
      const site = siteAt(j + 1);
      references.push({ key, op: splitter, rest, doubleDollar: false, site });
      i = j + 1;
      continue;
    }
    if (next !== undefined && identStart.test(next)) {
      let j = i + 2;
      while (j < value.length && identChar.test(value[j])) {
        j += 1;
      }
      const key = value.slice(i + 1, j);
      const site = siteAt(j);
      if (
        !isRunDependent(key) &&
        isSubstituted &&
        j === value.length &&
        outerSite.followedByIdent
      ) {
        return { references, ambiguous: "unbraced-join" };
      }
      references.push({ key, op: null, rest: "", doubleDollar: false, site });
      i = j;
      continue;
    }
    if (next === "$") {
      let k = i;
      while (k < value.length && value[k] === "$") {
        k += 1;
      }
      const dollars = k - i;
      const afterDollars = value[k];
      if (afterDollars === "{") {
        return { references, ambiguous: "assembled-dollar" };
      }
      if (afterDollars !== undefined && identStart.test(afterDollars)) {
        if (dollars >= 3) {
          return { references, ambiguous: "assembled-dollar" };
        }
        let j = k + 1;
        while (j < value.length && identChar.test(value[j])) {
          j += 1;
        }
        const key = value.slice(k, j);
        const site = siteAt(j);
        if (
          !isRunDependent(key) &&
          isSubstituted &&
          j === value.length &&
          outerSite.followedByIdent
        ) {
          return { references, ambiguous: "unbraced-join" };
        }
        references.push({ key, op: null, rest: "", doubleDollar: true, site });
        i = j;
        continue;
      }
      if (afterDollars === undefined) {
        if (isSubstituted && outerSite.followedByRefStart) {
          return { references, ambiguous: "trailing-dollar" };
        }
        i = k;
        continue;
      }
      i = k;
      continue;
    }
    if (next === undefined) {
      if (isSubstituted && outerSite.followedByRefStart) {
        return { references, ambiguous: "trailing-dollar" };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return { references };
}

// A dependency of the installed Nx, as Nx itself loads it.
export function nxDependency(nxFile: string, name: string): Record<string, unknown> {
  try {
    return loadNxDependency(nxFile, name);
  } catch (error) {
    if (error instanceof NxBridgeError && error.failure.kind === "load") {
      throw new TaskEnvironmentError(
        `${name} of the installed Nx cannot be loaded (${error.failure.reason})`,
      );
    }
    throw error;
  }
}
