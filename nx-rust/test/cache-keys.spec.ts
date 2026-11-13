import { describeCacheKeyMatrix, FileChanges } from "./harness";

// The plugin infers no target yet (nxr-fy4t4k declares the inputs), so these
// rows hash a target written by hand. They show that the matrix tells a key
// that changes from one that does not.
const probe: FileChanges = {
  "rust/crates/api/project.json": JSON.stringify({
    name: "api",
    targets: { test: { command: "cargo test", inputs: ["{projectRoot}/**/*"] } },
  }),
};

describeCacheKeyMatrix("cache keys", [
  {
    change: "a change in a file of the crate",
    fixture: "subfolder-workspace",
    base: { files: probe },
    after: { files: { "rust/crates/api/src/lib.rs": (source) => `${source}// changed\n` } },
    keys: { "api:test": "must differ" },
  },
  {
    change: "a change in a file outside the target's inputs",
    fixture: "subfolder-workspace",
    base: { files: probe },
    after: { files: { "rust/crates/model/src/lib.rs": (source) => `${source}// changed\n` } },
    keys: { "api:test": "must not differ" },
  },
]);
