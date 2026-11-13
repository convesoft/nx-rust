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
import { ToolFolders } from "./harness";

// The check that the executors make when a task that runs a tool starts
// (DES-DIAGNOSTICS). The executors do not exist yet (nxr-kmdpgj), so this
// checks the check itself, over the same table of tools that init reports.

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
