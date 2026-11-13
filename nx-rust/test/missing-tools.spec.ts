import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MissingToolError,
  missingToolMessage,
  OptionalToolId,
  optionalTools,
  requireTool,
  ToolContext,
  wasmTriple,
} from "../src/tools/optional-tools";
import { FixtureWorkspace, HARNESS_TIMEOUT, ToolFolders, withoutColours } from "./harness";

// The check that the executors make when a task that runs a tool starts
// (DES-DIAGNOSTICS), over the same table of tools that init reports, and the
// tasks that run such a tool today, audit and deny, through the real Nx and
// cargo (the fifth paragraph of VER-SETUP, and the missing tools of
// VER-TARGETS). The targets that run the other tools of the table do not
// exist yet; the issues that add them add their tasks here.

/** For each tool, what a test installs to make it present. */
const installs: Record<OptionalToolId, (tools: ToolFolders, root: string) => void> = {
  "cargo-nextest": (tools) => tools.install(tools.path, "cargo-nextest"),
  "cargo-affected": (tools) => tools.install(join(tools.cargoHome, "bin"), "cargo-affected"),
  "cargo-hakari": (tools) => tools.install(tools.path, "cargo-hakari"),
  "wasm-bindgen": (tools) => tools.install(tools.path, "wasm-bindgen"),
  "wasm-target": (tools) => {
    const sysroot = join(tools.base, "sysroot");
    mkdirSync(join(sysroot, "lib", "rustlib", wasmTriple), { recursive: true });
    tools.install(tools.path, "rustc", sysroot);
  },
  napi: (_tools, root) => {
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "napi"), "#!/bin/sh\n");
    chmodSync(join(bin, "napi"), 0o755);
  },
  "cargo-deny": (tools) => tools.install(tools.path, "cargo-deny"),
  "cargo-audit": (tools) => tools.install(join(tools.cargoHome, "bin"), "cargo-audit"),
};

describe("a task's check for the tool it runs", () => {
  let tools: ToolFolders;
  let root: string;
  let context: ToolContext;

  beforeEach(() => {
    tools = new ToolFolders();
    root = join(tools.base, "repo");
    mkdirSync(root);
    context = { workspaceRoot: root, workspaces: [{ root: "rust" }], env: tools.env() };
  });

  afterEach(() => tools.remove());

  it("covers every tool of the table that init reports", () => {
    expect(optionalTools.map((tool) => tool.id).sort()).toEqual(Object.keys(installs).sort());
  });

  it.each(optionalTools.map((tool) => [tool.id, tool] as const))(
    "fails without %s, naming the tool, what needs it and how to get it, and installs nothing",
    (id, tool) => {
      const neededBy = "the some-target target of the crate api";

      const error = (() => {
        try {
          requireTool(id, neededBy, context);
        } catch (e) {
          return e;
        }
        return undefined;
      })();

      expect(error).toBeInstanceOf(MissingToolError);
      const message = (error as Error).message;
      expect(message.toLowerCase()).toContain(tool.name.toLowerCase());
      expect(message).toContain(`but ${neededBy} needs it.`);
      expect(message).toContain(tool.install);
      expect(message).toBe(missingToolMessage(tool, [neededBy]));
      // Nothing was put where the check looks.
      expect(readdirSync(tools.path)).toEqual([]);
      expect(readdirSync(join(tools.cargoHome, "bin"))).toEqual([]);
    },
  );

  it.each(optionalTools.map((tool) => [tool.id] as const))("passes with %s installed", (id) => {
    installs[id](tools, root);

    expect(() => requireTool(id, "anything", context)).not.toThrow();
  });

  it("looks for the wasm target in the toolchain of the folder the task runs in", () => {
    // A rustc whose sysroot depends on the folder it runs in, as rustup's
    // does where a folder pins a toolchain.
    writeFileSync(join(tools.path, "rustc"), "#!/bin/sh\nprintf '%s\\n' \"$PWD/sysroot\"\n");
    chmodSync(join(tools.path, "rustc"), 0o755);
    const workspace = join(root, "rust");
    mkdirSync(join(workspace, "sysroot", "lib", "rustlib", wasmTriple), { recursive: true });

    expect(() =>
      requireTool("wasm-target", "the wasm-build target", { ...context, folder: workspace }),
    ).not.toThrow();
    expect(() => requireTool("wasm-target", "the wasm-build target", context)).toThrow(
      MissingToolError,
    );
  });

  it("counts a relative PATH entry and a relative Cargo home from the folder where cargo runs", () => {
    const folder = join(root, "rust");
    tools.install(join(folder, "tools"), "cargo-deny");
    tools.install(join(folder, "home", "bin"), "cargo-audit");
    const relative = { ...context, env: { PATH: "tools", CARGO_HOME: "home" }, folder };

    expect(() => requireTool("cargo-deny", "deny", relative)).not.toThrow();
    expect(() => requireTool("cargo-audit", "audit", relative)).not.toThrow();
    // From the repository root, where neither is installed.
    expect(() => requireTool("cargo-deny", "deny", { ...relative, folder: root })).toThrow(
      MissingToolError,
    );
    expect(() => requireTool("cargo-audit", "audit", { ...relative, folder: root })).toThrow(
      MissingToolError,
    );
    // An empty entry of PATH stands for the folder itself.
    tools.install(folder, "cargo-hakari");
    expect(() =>
      requireTool("cargo-hakari", "hakari", { ...relative, env: { PATH: `${tools.path}:` } }),
    ).not.toThrow();
  });

  it("names every feature that needs a tool, as init's report does", () => {
    const tool = optionalTools.find((candidate) => candidate.id === "cargo-deny")!;

    expect(missingToolMessage(tool, ["the deny target of rust", "the deny target of tools"])).toBe(
      "cargo-deny is not installed, but the deny target of rust and the deny target of tools need it. Install it with `cargo install --locked cargo-deny` (https://crates.io/crates/cargo-deny).",
    );
  });

  it("starts the message with the tool's name in a sentence", () => {
    const tool = optionalTools.find((candidate) => candidate.id === "napi")!;

    expect(missingToolMessage(tool, ["the napi-build target of the crate addon"])).toMatch(
      /^The napi CLI is not installed, but the napi-build target of the crate addon needs it\./,
    );
  });
});

describe("a task whose tool is missing", () => {
  let tools: ToolFolders;
  let workspace: FixtureWorkspace;

  beforeEach(() => {
    // An empty PATH and Cargo home hide the tools that the machine has.
    tools = new ToolFolders();
    workspace = FixtureWorkspace.create("crate-shapes", { "rust/deny.toml": "" });
  });

  afterEach(() => {
    workspace.remove();
    tools.remove();
  });

  /** Runs a task of the workspace project in rust, by default with the hidden tools. */
  async function run(target: string, env: Record<string, string> = tools.env()) {
    const { status, output } = await workspace.nx(
      ["run", `rust:${target}`, "--output-style=static"],
      env,
    );
    return { status, output: withoutColours(output) };
  }

  /** The cargo calls of tasks: every logged call but graph creation's `cargo metadata`. */
  const taskCalls = () => workspace.cargoCalls().filter((call) => call.args[0] !== "metadata");

  it.each<[string, OptionalToolId]>([
    ["audit", "cargo-audit"],
    ["deny", "cargo-deny"],
  ])(
    "fails %s before cargo runs, naming the tool, the target and how to get it, and installs nothing",
    async (target, id) => {
      const tool = optionalTools.find((candidate) => candidate.id === id)!;

      const missing = await run(target);

      expect(missing.status).toBe(1);
      expect(missing.output).toContain(
        `rust:${target}: ${missingToolMessage(tool, [`the ${target} target of the Cargo workspace in rust`])}`,
      );
      expect(taskCalls()).toEqual([]);
      expect(readdirSync(tools.path)).toEqual([]);
      expect(readdirSync(join(tools.cargoHome, "bin"))).toEqual([]);

      // The positive control: with a stand-in for the tool, the same task
      // runs cargo, so Nx replays nothing that the failed run left.
      installs[id](tools, workspace.root);
      const present = await run(target);

      expect(present.status).toBe(0);
      expect(present.output).not.toContain("is not installed");
      expect(taskCalls()).toEqual([
        { cwd: "rust", args: [target, ...(target === "deny" ? ["check"] : [])] },
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "counts a relative PATH entry from the workspace root, where plain cargo looks too",
    async () => {
      const env = { ...tools.env(), PATH: "tools" };

      // In the repository root's tools, cargo would not find it in rust.
      tools.install(join(workspace.root, "tools"), "cargo-audit");
      const missing = await run("audit", env);

      expect(missing.status).toBe(1);
      expect(missing.output).toContain(
        "rust:audit: cargo-audit is not installed, but the audit target of the Cargo workspace in rust needs it.",
      );
      expect(taskCalls()).toEqual([]);

      // In rust/tools, cargo finds it, and so does the check.
      tools.install(join(workspace.root, "rust", "tools"), "cargo-audit", "the stand-in ran");
      const present = await run("audit", env);

      expect(present.status).toBe(0);
      expect(present.output).toContain("the stand-in ran");
      expect(taskCalls()).toEqual([{ cwd: "rust", args: ["audit"] }]);
    },
    HARNESS_TIMEOUT,
  );
});
