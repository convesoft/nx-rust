import { type ArtifactSubject, producesArtifact, shellQuote } from "./artifact-kinds";

/** The triple that `wasm-build` compiles for (`DES-WASM`). */
export const wasmTriple = "wasm32-unknown-unknown";

/**
 * The folder in the crate's folder that `wasm-build` writes the package to,
 * as wasm-pack names it, outside Cargo's directories (`DES-WASM`). It is the
 * target's output and no input of the crate's targets.
 */
export const wasmPackageFolder = "pkg";

/** The wasm targets of the `wasm-bindgen` CLI that `wasm-build` takes, its `--target` values (`DES-WASM`). */
export const wasmTargets = ["bundler", "web", "nodejs"] as const;

/** A wasm target of {@link wasmTargets}. */
export type WasmTarget = (typeof wasmTargets)[number];

/** The wasm target that the inferred `wasm-build` sets in its options: the CLI's own default. */
export const defaultWasmTarget: WasmTarget = "bundler";

/**
 * The variables that the `wasm-bindgen` CLI reads and that change what it
 * writes: in 0.2.130, `WASM_BINDGEN_ANYREF` and `WASM_BINDGEN_EXTERNREF`
 * turn on reference types and `WASM_BINDGEN_MULTI_VALUE` multi-value
 * returns, whatever their value (`EVD-WASM-POSTPROCESS`).
 */
export const wasmBindgenVariables = [
  "WASM_BINDGEN_ANYREF",
  "WASM_BINDGEN_EXTERNREF",
  "WASM_BINDGEN_MULTI_VALUE",
] as const;

/**
 * Whether a crate produces a wasm package (`DES-ARTIFACT-STEPS`): its
 * library target has the crate type `cdylib` and it depends directly,
 * through a normal dependency, on `wasm-bindgen`, also one declared for one
 * platform only. An `artifacts` list in the crate's `[package.metadata.nx]`
 * replaces the inference.
 */
export function producesWasmPackage(subject: ArtifactSubject): boolean {
  return producesArtifact(subject, "wasm");
}

/**
 * The inputs that `wasm-build` has beside those of `build` (`DES-INPUTS`,
 * `REQ-ARTIFACT-CACHE`):
 *
 * - an `env` input for each of {@link wasmBindgenVariables}, for its value;
 * - a `runtime` input that prints what `wasm-bindgen --version` writes in
 *   the workspace root, where the task finds the CLI on `PATH` as the
 *   executor does, or a random value, new at each evaluation, where it
 *   fails, so that no stored result is restored; and then one line per
 *   variable of {@link wasmBindgenVariables} that says whether it is set.
 *   The CLI turns each on by its presence, also with an empty value, while
 *   Nx 24 hashes an unset and an empty `env` input alike
 *   (`EVD-WASM-POSTPROCESS`), so only these lines tell the two apart. Nx
 *   runs the command with the task's environment, its dotenv files
 *   included, as the batch gives it to the CLI (`EVD-NX-24-INPUT-SEMANTICS`).
 *
 * The triple is a constant of the target, whose name and options Nx
 * hashes, and the toolchain input names the compiler.
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-ARTIFACT-CACHE
export function wasmInputs(workspaceRoot: string): ({ runtime: string } | { env: string })[] {
  const presence = wasmBindgenVariables.map(
    (name) => `if [ -n "\${${name}+x}" ]; then echo '${name} set'; else echo '${name} unset'; fi`,
  );
  return [
    ...wasmBindgenVariables.map((env) => ({ env })),
    {
      runtime: [
        `{ cd ${shellQuote(workspaceRoot)} && wasm-bindgen --version; } 2>/dev/null || od -An -N16 -tx1 /dev/urandom`,
        ...presence,
        "true",
      ].join("; "),
    },
  ];
}
