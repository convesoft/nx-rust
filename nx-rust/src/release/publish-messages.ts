import type { Task } from "@nx/devkit";
import { isDeepStrictEqual } from "node:util";
import { releasePublishExecutor, releasePublishTarget } from "../graph/targets";
import { type Lookup, type Registry, registryLabel } from "./publish-cargo";
import type { Crate, DependencyLink, Prepared, Runner } from "./publish-crates";
import { settingDifferences } from "./publish-settings";

/** The options of `@convesoft/nx-rust:release-publish` that Nx's npm publishing has and cargo has not. */
export const npmOptions: Readonly<Record<string, string>> = {
  tag: "distribution tags",
  access: "access levels",
  otp: "one-time passwords",
};

/** cargo-hakari's guide to publishing crates that depend on the hack crate. */
const hakariPublishing = "https://docs.rs/cargo-hakari/latest/cargo_hakari/publishing";

/**
 * The check _Dependencies published elsewhere_: the registry that the
 * dependency's entry points to has to be established as the dependency's
 * own target registry, which only three cases do (`DES-RELEASE`, "Where a
 * dependency points").
 *
 * @returns The failure message, or `undefined` where the check passes.
 */
export function publishedElsewhere(
  task: Prepared,
  link: DependencyLink,
  established: { target: Registry; source: string },
  own: Runner,
): string | undefined {
  const { dependency, points } = link;
  const { target } = established;
  const sameWorkspace = dependency.workspaceRoot === task.crate.workspaceRoot;
  // Cargo's settings, apart from the choice of the target registry, in
  // which the two environments differ.
  const differing = settingDifferences(task.env, own.env, ["CARGO_REGISTRY_DEFAULT"]);
  if (points.kind === "crates-io" && target.kind === "crates-io") {
    return undefined;
  }
  let reason: string;
  if (points.kind === "named" && target.kind === "named") {
    if (sameWorkspace && points.name === target.name && differing.length === 0) {
      return undefined;
    }
    const variable = indexVariable(target.name);
    const index = own.env[variable];
    if (index !== undefined && sameIndex(index, points.index)) {
      return undefined;
    }
    const where = own.envKey === task.envKey ? "" : `in the environment of ${own.label}, `;
    reason = !sameWorkspace
      ? `the two crates lie in different Cargo workspaces, whose configuration files can give one name different indexes, and ${where}${variable} ${index === undefined ? "is not set" : `gives ${index}`} where the entry's index is ${points.index}`
      : points.name === target.name
        ? `${task.label} and ${own.label} run with different Cargo settings, ${sentenceAnd(differing)}, with which one name can stand for different indexes, and ${where}${variable} ${index === undefined ? "is not set" : `gives ${index}`} where the entry's index is ${points.index}`
        : `the entry names \`${points.name}\`, not \`${target.name}\`, and ${where}${variable} does not give \`${target.name}\` the index that \`${points.name}\` has (${points.index})`;
  } else if (points.kind === "crates-io") {
    reason =
      "the entry has no `registry` key, so the published crate would depend on crates.io's crate of that name, also where the Cargo configuration replaces crates.io";
  } else {
    reason = `the entry names \`${points.name}\``;
  }
  const pointsLabel = points.kind === "crates-io" ? "crates.io" : `the registry \`${points.name}\``;
  const remedies =
    target.kind === "crates-io"
      ? ["remove the `registry` key from that entry, so that it points to crates.io"]
      : [
          `add \`registry = "${target.name}"\` to that entry, or correct it to name \`${target.name}\``,
          "configure each registry's index under one name",
          ...(sameWorkspace
            ? []
            : [
                `because ${dependency.name} lies in another Cargo workspace, give the registry's index in the environment as ${indexVariable(target.name)}, so that it is the same for every workspace, or keep both crates in one Cargo workspace`,
              ]),
        ];
  if (own.envKey !== task.envKey) {
    remedies.push(
      "give the crates of one release the same Cargo settings, such as in the environment of the command or in .cargo/config.toml, rather than in a dotenv file of one crate",
    );
  }
  return [
    `${task.label}: ${task.crate.name} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to ${pointsLabel}, while ${dependency.name} is published to ${registryLabel(target)}, ${established.source}, and @convesoft/nx-rust cannot establish that these are one registry: ${reason}. Nothing was uploaded for ${task.crate.name}: cargo would publish it with a dependency on the crate of that name in ${pointsLabel}.`,
    `  To publish it, ${sentence(remedies)}.`,
  ].join("\n");
}

/**
 * The message of a task whose options hold `registry` (`DES-RELEASE`,
 * "Options"; `ADR-PUBLISH-REGISTRY-OPTION`): where the value came from, as
 * the overrides of the task graph tell it, Cargo's own ways to choose a
 * registry, and how npm packages alone get one.
 */
// @mara implements DES-RELEASE
export function registryOptionMessage(label: string, value: unknown, task: Task): string {
  const source = passedToCommand(task, "registry", value)
    ? `${label}: the option \`registry\` (${valueText(value)}) was passed to \`nx release publish\`, and nx-rust does not map it to a Cargo registry. Nothing was published.`
    : [
        `${label}: the option \`registry\` (${valueText(value)}) comes from the workspace's configuration, and nx-rust does not map it to a Cargo registry. Nothing was published.`,
        `  Run \`nx show target ${label} --json\` and look under \`sourceMap\` for the file and entry. An entry of \`targetDefaults\` keyed by \`${releasePublishTarget}\` and written for npm reaches crates as well, unless it has a \`filter\` or nx.json has the empty entry keyed by "${releasePublishExecutor}" that \`nx add @convesoft/nx-rust\` adds; an entry keyed by "@nx/js:release-publish" reaches npm packages only.`,
      ].join("\n");
  return [
    source,
    `  Cargo chooses the registry itself: set \`publish = ["<name>"]\` in the crate's Cargo.toml or \`registry.default\` in .cargo/config.toml, or run \`CARGO_REGISTRY_DEFAULT=<name> nx release publish\` for one run. Dependencies on crates of this repository then need \`registry = "<name>"\` in their entries.`,
    "  To give npm packages alone a registry, publish them in a run of their own (`nx release publish --groups <group> --registry <url>`) or set it in .npmrc.",
  ].join("\n");
}

/** The line of a task that ignores one of npm's options `tag`, `access` and `otp` (`DES-RELEASE`, "Options"). */
export function npmOptionLine(label: string, name: string, value: unknown, task: Task): string {
  const source = passedToCommand(task, name, value)
    ? "passed to `nx release publish`"
    : `which comes from the workspace's configuration (run \`nx show target ${label} --json\` and look under \`sourceMap\`)`;
  return `${label}: ignoring option \`${name}\` (${valueText(value)}), ${source}: it is npm's, and cargo publish has no ${npmOptions[name]}. Nothing changes for crates; to give it to npm packages alone, publish them in a run of their own.`;
}

export function notVerifiedMessage(
  task: Prepared,
  dependency: Crate,
  dependencyTask: string,
): string {
  return `${task.label}: ${task.crate.name} ${task.crate.version} was not verified, because it needs ${dependency.name} ${dependency.version}, which ${dependencyTask} would publish in another cargo call, and a dry run of one cargo call cannot verify a crate against a version that another call would publish. Nothing was uploaded. The real nx release publish checks before the upload that ${dependency.name} ${dependency.version} is in the registry.`;
}

export function publishFirstMessage(
  task: Prepared,
  dependency: Crate,
  registry: Registry,
  failed: Prepared | undefined,
): string {
  const head = `${task.label}: ${task.crate.name} needs ${dependency.name} ${dependency.version}, which is not in ${registryLabel(registry)} yet${failed === undefined ? "" : `, because ${failed.label} failed in this run`}, so @convesoft/nx-rust does not publish ${task.crate.name}, and nothing was uploaded for it: cargo would publish it against an older version of ${dependency.name} that its requirement accepts.`;
  if (dependency.hack) {
    return `${head} ${dependency.name} is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes: publish its stub ${dependency.name} ${dependency.version} to ${registryLabel(registry)} once yourself, as ${hakariPublishing} describes, and run nx release publish again.`;
  }
  return `${head} Publish ${dependency.name} first: in the same nx release publish, which publishes a dependency's Cargo workspace and release group first, or by running ${dependency.project === undefined ? `the publishing of ${dependency.name}` : `${dependency.project}:${releasePublishTarget}`} before this task.`;
}

/**
 * The check _Unpublished dependencies_ (`DES-RELEASE`): a dependency that is
 * not published to the registry that its entry points to, through
 * `publish = false` or a `publish` list that does not hold that registry by
 * the entry's own name, `crates-io` for crates.io, fails the crate, because
 * cargo packages the dependency for that registry whatever its `publish`
 * says (`EVD-CARGO-PUBLISH`). Where the entry points to a registry whose
 * name the executor did not find, a `publish` list cannot be compared with
 * it, and the crate fails as well. For a hack crate, the message adds
 * cargo-hakari's two ways (**Hack crate**).
 *
 * @param manifest The dependency's manifest, relative to the repository root.
 * @returns The failure message, or `undefined` where the check passes.
 */
// @mara implements DES-RELEASE
export function unpublishedMessage(
  task: { label: string; crate: { name: string } },
  link: DependencyLink,
  manifest: string,
): string | undefined {
  const { dependency, points } = link;
  const list = dependency.publish;
  if (list === null) {
    return undefined;
  }
  const crate = task.crate.name;
  if (points.kind === "named" && points.name === "") {
    return [
      `${task.label}: ${crate} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to the registry with the index ${points.index}, and @convesoft/nx-rust finds no \`registry\` key in that entry, so it cannot establish whether the publish list of ${dependency.name} in ${manifest}, ${JSON.stringify(list)}, holds that registry. Nothing was uploaded for ${crate}.`,
      `  To publish it, name the registry in that entry with \`registry = "<name>"\`, by a name that the publish list of ${dependency.name} holds.`,
    ].join("\n");
  }
  const name = points.kind === "crates-io" ? "crates-io" : points.name;
  if (list.includes(name)) {
    return undefined;
  }
  const pointsLabel = points.kind === "crates-io" ? "crates.io" : `the registry \`${points.name}\``;
  const why =
    list.length === 0
      ? `${manifest} sets \`publish = false\``
      : `its publish list in ${manifest}, ${JSON.stringify(list)}, does not hold \`${name}\``;
  const remedies = [
    list.length === 0
      ? `publish ${dependency.name} to ${pointsLabel} as well, by removing \`publish = false\` from its manifest`
      : `publish ${dependency.name} to ${pointsLabel} as well, by adding "${name}" to its publish list`,
    ...(list.length === 0
      ? []
      : [
          `name in that entry, with its \`registry\` key, a registry that the publish list of ${dependency.name} holds, ${sentenceOr(list.map((entry) => `\`${entry}\``))}`,
        ]),
    `make ${dependency.name} no normal or build dependency of ${crate}`,
  ];
  return [
    `${task.label}: ${crate} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to ${pointsLabel}, and ${dependency.name} is not published there: ${why}. Nothing was uploaded for ${crate}: cargo would package it for ${pointsLabel} with a dependency on ${dependency.name}, which fails to resolve there or resolves to an unrelated crate of that name.`,
    `  To publish it, ${sentenceWith(remedies, "or")}.`,
    ...(dependency.hack
      ? [
          `  ${dependency.name} is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes. cargo-hakari offers two ways: publish a stub of the hack crate once under a name of your own and without \`publish = false\`, after which ${crate} publishes normally; or publish ${crate} with \`cargo hakari publish -p ${crate}\` outside Nx, which takes the dependency out for the upload. See ${hakariPublishing}.`,
        ]
      : []),
  ].join("\n");
}

/** The guidance for a crate that would publish to crates.io where the Cargo configuration replaces crates.io (`ADR-PUBLISH-REPLACED-CRATES-IO`). */
export function replacedCratesIoAdvice(crate: string): string {
  return `The Cargo configuration replaces crates.io, such as with a mirror, so @convesoft/nx-rust cannot establish that its checks ask crates.io, where cargo would upload ${crate}. Publish ${crate} to crates.io from a job whose Cargo configuration does not replace crates.io, or publish it to another registry with \`publish = ["<name>"]\`, registry.default or CARGO_REGISTRY_DEFAULT.`;
}

/** The message of a lookup that did not establish its source or failed (`DES-RELEASE`, "Lookups"). */
export function lookupFailure(
  task: Prepared,
  crate: Crate,
  registry: Registry,
  lookup: Lookup,
  folder: string,
): string {
  if (lookup.kind === "failed") {
    return [
      `${task.label}: \`${lookup.command}\`, run in ${folder}, failed, so @convesoft/nx-rust cannot tell whether ${crate.name} ${crate.version} is in ${registryLabel(registry)}, and nothing was uploaded for ${task.crate.name}. Make sure that the registry can be reached and run nx release publish again. cargo printed:`,
      lookup.output.trimEnd(),
    ].join("\n");
  }
  if (lookup.kind !== "unestablished") {
    return `${task.label}: the lookup of ${crate.name} ${crate.version} in ${registryLabel(registry)} gave no answer.`;
  }
  const head = `${task.label}: \`${lookup.command}\`, run in ${folder}, showed ${lookup.shown} in place of ${registryLabel(registry)}, so @convesoft/nx-rust cannot tell which registry it asked about ${crate.name} ${crate.version}, and nothing was uploaded for ${task.crate.name}.`;
  if (registry.kind === "crates-io" && lookup.shown !== "no line that starts with Updating") {
    return [head, `  ${replacedCratesIoAdvice(crate.name)}`].join("\n");
  }
  return [
    head,
    `  Configure each registry under one name, the same in every Cargo workspace, without a source replacement for the registry you publish to, and publish online: offline, as with CARGO_NET_OFFLINE=true or net.offline, cargo does not show which registry it asked, and it refuses to publish anyway.`,
  ].join("\n");
}

/** `CARGO_REGISTRIES_<NAME>_INDEX` for a registry's name, as cargo spells it. */
function indexVariable(name: string): string {
  return `CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, "_")}_INDEX`;
}

/** Whether two index URLs are the same, apart from a final `/`. */
function sameIndex(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

/** Each line of a message indented by two spaces. */
export function indented(message: string): string {
  return message
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** "a, b and c". */
export function sentenceAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `<project>:<target>`, with `:<configuration>` where the task has one. */
export function configuredLabel(task: Task): string {
  const { configuration } = task.target;
  return configuration === undefined ? labelOf(task) : `${labelOf(task)}:${configuration}`;
}

export function labelOf(task: Task): string {
  return `${task.target.project}:${task.target.target}`;
}

/** Whether Nx put `name` with `value` among the overrides of the task, which it does only for options of the command. */
function passedToCommand(task: Task, name: string, value: unknown): boolean {
  const overrides: Record<string, unknown> | undefined = task.overrides;
  return (
    overrides !== undefined &&
    Object.prototype.hasOwnProperty.call(overrides, name) &&
    isDeepStrictEqual(overrides[name], value)
  );
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** "a; b; and c" as the end of a sentence. */
function sentence(items: readonly string[]): string {
  return sentenceWith(items, "and");
}

/** "a; b; <word> c" as the end of a sentence. */
function sentenceWith(items: readonly string[], word: "and" | "or"): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join("; ")}; ${word} ${items[items.length - 1]}`;
}

/** "a, b or c". */
function sentenceOr(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
