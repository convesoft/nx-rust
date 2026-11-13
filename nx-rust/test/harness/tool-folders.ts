import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A folder on `PATH` and a Cargo home, both empty, so that none of the tools
 * of init's table is installed, wherever the machine keeps its own.
 */
export class ToolFolders {
  readonly base = mkdtempSync(join(tmpdir(), "nx-rust-tools-"));
  readonly path = join(this.base, "bin");
  readonly cargoHome = join(this.base, "cargo-home");

  constructor() {
    mkdirSync(this.path);
    mkdirSync(join(this.cargoHome, "bin"), { recursive: true });
  }

  /** The variables that make Nx look here; the harness puts the cargo wrapper first on PATH. */
  env(): Record<string, string> {
    return { PATH: this.path, CARGO_HOME: this.cargoHome };
  }

  /** Installs an executable that does nothing, or prints `output`. */
  install(folder: string, name: string, output = ""): void {
    mkdirSync(folder, { recursive: true });
    const file = join(folder, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    chmodSync(file, 0o755);
  }

  remove(): void {
    rmSync(this.base, { recursive: true, force: true });
  }
}
