import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEnvironment } from "./environment";

/** A program of a Rust toolchain that a setting can name. */
export type ToolchainProgram = "rustc" | "rustdoc";

/**
 * The path of a program of an installed toolchain, as `rustup which` gives
 * it: of `toolchain`, or of rustup's default toolchain without one. rustup
 * installs nothing (`RUSTUP_AUTO_INSTALL=0` in {@link testEnvironment}).
 *
 * @throws {Error} When rustup cannot name it, as for a toolchain that is not installed.
 */
export function toolchainProgram(program: ToolchainProgram, toolchain?: string): string {
  const result = spawnSync(
    "rustup",
    ["which", program, ...(toolchain === undefined ? [] : ["--toolchain", toolchain])],
    // A folder without a toolchain file, so that the default applies.
    { cwd: tmpdir(), env: testEnvironment(), encoding: "utf8" },
  );
  const path = result.stdout?.trim();
  if (result.status !== 0 || !path) {
    throw new Error(
      `rustup which ${program} failed for ${toolchain ?? "the default toolchain"}:\n${result.stderr ?? result.error?.message}`,
    );
  }
  return path;
}

/** The first line that `program -V` prints, such as `rustc 1.91.0 (f8297e351 2025-10-28)`. */
export function programVersion(program: string): string {
  const result = spawnSync(program, ["-V"], { env: testEnvironment(), encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${program} -V failed:\n${result.stderr ?? result.error?.message}`);
  }
  return result.stdout.trim();
}

/**
 * A folder of symbolic links named `rustc` and `rustdoc` to the programs of
 * an installed toolchain. A test names a link in a setting such as `RUSTC`
 * and then points the links at another toolchain, so that the compiler at
 * that path changes while the path and the setting stay the same, as when
 * `rustup update` replaces the compiler of a channel's path
 * (`EVD-CARGO-COMPILER-SELECTION`). A linked rustc finds its toolchain's
 * libraries through its real path.
 */
export class CompilerLinks {
  private constructor(
    /** The folder that holds the links. */
    readonly folder: string,
  ) {}

  /**
   * Creates the links in a new temporary folder, pointing at `toolchain`, or
   * at the default toolchain without one.
   */
  static create(toolchain?: string): CompilerLinks {
    const links = new CompilerLinks(mkdtempSync(join(tmpdir(), "nx-rust-compilers-")));
    try {
      links.point(toolchain);
    } catch (error) {
      links.remove();
      throw error;
    }
    return links;
  }

  /** The link named `rustc`. */
  get rustc(): string {
    return join(this.folder, "rustc");
  }

  /** The link named `rustdoc`. */
  get rustdoc(): string {
    return join(this.folder, "rustdoc");
  }

  /** Points both links at the programs of `toolchain`, or of the default toolchain without one. */
  point(toolchain?: string): void {
    for (const program of ["rustc", "rustdoc"] as const) {
      const target = toolchainProgram(program, toolchain);
      rmSync(join(this.folder, program), { force: true });
      symlinkSync(target, join(this.folder, program));
    }
  }

  /** Deletes the folder with its links. */
  remove(): void {
    rmSync(this.folder, { recursive: true, force: true });
  }
}
