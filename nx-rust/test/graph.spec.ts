import { GraphCreationError, HARNESS_TIMEOUT, loadFixtureGraph } from "./harness";

describe("project graph of a fixture", () => {
  it(
    "loads the fixture through the plugin",
    async () => {
      // The plugin infers no project yet (nxr-7n0nqf), so a project added by
      // hand shows that the fixture reached Nx.
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: { "rust/crates/api/project.json": JSON.stringify({ name: "probe" }) },
      });

      expect(Object.keys(graph.projects)).toEqual(["probe"]);
      expect(graph.projects.probe.root).toBe("rust/crates/api");
      expect(graph.dependencies).toEqual([]);
      expect(graph.cargoCalls).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reports a failed graph creation with Nx's message",
    async () => {
      const loading = loadFixtureGraph("subfolder-workspace", {
        files: { "nx.json": JSON.stringify({ plugins: ["./missing-plugin.js"] }) },
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      await expect(loading).rejects.toThrow(/missing-plugin/);
    },
    HARNESS_TIMEOUT,
  );
});
