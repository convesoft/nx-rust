import {
  cratesIo,
  lookupArguments,
  probeArguments,
  publishArguments,
  readLookup,
  refusedPublishList,
  refusedReplacedCratesIo,
  refusedStaleLockfile,
  refusedUncommittedChanges,
  registryFromProbe,
  shownRegistry,
  uploadedCrates,
  verifiedCrates,
} from "../src/release/publish-cargo";

// Checks how the publish executor reads what cargo prints (`DES-RELEASE`,
// "Target registry" and "Lookups"), with the lines that cargo 1.100.0 and
// 1.91.0 printed in the runs of `EVD-CARGO-PUBLISH-REGISTRIES`, among them
// those of configurations that the harness cannot reproduce, such as a
// second name for one index that cargo showed in place of the name passed.
// The end-to-end cases of VER-RELEASE run the real cargo against the
// harness registries.

const alpha = { kind: "named", name: "alpha" } as const;

/** A lookup's output as cargo splits it: the description on standard output, the status lines on standard error. */
function lookupRun(status: number, stderr: string, stdout = "") {
  return { status, stdout, stderr, output: `${stderr}${stdout}` };
}

describe("reading cargo's output for publishing", () => {
  it("reads the registry from the first Updating line, also below a note and before a failure", () => {
    expect(
      shownRegistry(
        "note: found `alpha` as only allowed registry. Publishing to it automatically.\n    Updating `alpha` index\n    Updating `beta` index\n",
      ),
    ).toEqual({ kind: "named", name: "alpha" });
    expect(shownRegistry("    Updating crates.io index\nerror: failed\n")).toEqual({
      kind: "crates-io",
    });
    expect(
      shownRegistry("error: crates-io is replaced with remote registry nx-rust-test;\n"),
    ).toEqual({
      kind: "none",
    });
    expect(shownRegistry("    Updating something else\n")).toEqual({
      kind: "other",
      line: "Updating something else",
    });
  });

  it("establishes a lookup only where the Updating line and the version line name the registry as passed", () => {
    const found = lookupRun(
      0,
      "    Updating `alpha` index\n Downloading crates ...\n",
      "pub-a\nx\nversion: 0.1.0 (from registry `alpha`)\nlicense: MIT\n",
    );
    expect(readLookup("pub-a", "0.1.0", alpha, found)).toEqual({ kind: "found" });

    const missing = lookupRun(
      101,
      "    Updating `alpha` index\nerror: could not find `pub-a@0.2.0` in registry `sparse+http://127.0.0.1:1/alpha/index/`\n",
    );
    expect(readLookup("pub-a", "0.2.0", alpha, missing)).toEqual({ kind: "missing" });

    // alpha replaced by beta: the lookup asked beta.
    expect(
      readLookup(
        "a",
        "0.1.1",
        alpha,
        lookupRun(0, "    Updating `beta` index\n", "version: 0.1.1 (from registry `alpha-src`)\n"),
      ),
    ).toMatchObject({ kind: "unestablished", shown: "`beta`" });
    // A replacement table named alpha that holds beta's index.
    expect(
      readLookup(
        "a",
        "0.1.1",
        alpha,
        lookupRun(
          0,
          "    Updating `alpha` index\n",
          "version: 0.1.1 (from registry `alpha-src`)\n",
        ),
      ),
    ).toMatchObject({ kind: "unestablished", shown: "`alpha-src`" });
    // Two names for one index, of which cargo showed the other.
    expect(
      readLookup(
        "a",
        "0.1.0",
        alpha,
        lookupRun(0, "    Updating `alias` index\n", "version: 0.1.0 (from registry `alias`)\n"),
      ),
    ).toMatchObject({ kind: "unestablished", shown: "`alias`" });
    // Offline: no Updating line, an answer from the cache.
    expect(
      readLookup("a", "0.1.0", alpha, lookupRun(0, "", "version: 0.1.0 (from registry `alpha`)\n")),
    ).toMatchObject({ kind: "unestablished", shown: "no line that starts with Updating" });
    // An unreachable registry.
    expect(
      readLookup(
        "a",
        "0.1.0",
        alpha,
        lookupRun(
          101,
          "    Updating `alpha` index\nerror: failed to load source for dependency `a`\n",
        ),
      ),
    ).toMatchObject({ kind: "failed", command: "cargo info a@0.1.0 --registry alpha --locked" });
  });

  it("establishes a lookup on crates.io only by Updating crates.io index, so that a replacement shows", () => {
    expect(
      readLookup(
        "a",
        "0.1.0",
        cratesIo,
        lookupRun(
          101,
          "    Updating `nx-rust-test` index\nerror: could not find `a@0.1.0` in registry `sparse+https://index.crates.io/`\n",
        ),
      ),
    ).toMatchObject({
      kind: "unestablished",
      shown: "`nx-rust-test`",
      command: "cargo info a@0.1.0 --index sparse+https://index.crates.io/ --locked",
    });
    expect(
      readLookup(
        "a",
        "0.1.0",
        cratesIo,
        lookupRun(
          101,
          "    Updating crates.io index\nerror: could not find `a@0.1.0` in registry `sparse+https://index.crates.io/`\n",
        ),
      ),
    ).toEqual({ kind: "missing" });
  });

  it("names the list's entry for one entry, the entry that the probe names for several, and what it shows without a list", () => {
    const shownAlias = { kind: "named", name: "alias" } as const;
    expect(registryFromProbe(["alpha"], shownAlias)).toEqual(alpha);
    expect(registryFromProbe(["alpha", "beta"], shownAlias)).toBeUndefined();
    expect(registryFromProbe(["alpha", "beta"], { kind: "named", name: "beta" })).toEqual({
      kind: "named",
      name: "beta",
    });
    expect(registryFromProbe(["alpha", "crates-io"], { kind: "crates-io" })).toEqual(cratesIo);
    expect(registryFromProbe(null, shownAlias)).toEqual(shownAlias);
    expect(registryFromProbe(null, { kind: "crates-io" })).toEqual(cratesIo);
    expect(registryFromProbe(null, { kind: "other", line: "Updating x" })).toBeUndefined();
    expect(registryFromProbe(["crates-io"], { kind: "crates-io" })).toEqual(cratesIo);
  });

  it("builds the commands with --locked, never --registry crates-io, no token and no --allow-dirty", () => {
    expect(lookupArguments("a", "0.1.0", cratesIo)).toEqual([
      "info",
      "a@0.1.0",
      "--index",
      "sparse+https://index.crates.io/",
      "--locked",
    ]);
    expect(lookupArguments("a", "0.1.0", alpha)).toEqual([
      "info",
      "a@0.1.0",
      "--registry",
      "alpha",
      "--locked",
    ]);
    expect(probeArguments("a")).toEqual([
      "publish",
      "--dry-run",
      "--no-verify",
      "--locked",
      "-p",
      "a",
    ]);
    expect(publishArguments(["a", "b"], cratesIo, false)).toEqual([
      "publish",
      "--locked",
      "-p",
      "a",
      "-p",
      "b",
    ]);
    expect(publishArguments(["a"], alpha, true)).toEqual([
      "publish",
      "--dry-run",
      "--locked",
      "--registry",
      "alpha",
      "-p",
      "a",
    ]);
  });

  it("counts a crate as verified only where its verification reached Finished or cargo went on to upload it", () => {
    // pub-core failed to compile while cargo verified it, after pub-base.
    const failed = [
      "   Packaging pub-base v0.1.0 (/w/rust/crates/base)",
      "   Packaging pub-core v0.1.0 (/w/rust/crates/core)",
      "   Verifying pub-base v0.1.0 (/w/rust/crates/base)",
      "   Compiling pub-base v0.1.0 (/w/rust/target/package/pub-base-0.1.0)",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s",
      "   Verifying pub-core v0.1.0 (/w/rust/crates/core)",
      "   Compiling pub-base v0.1.0 (registry `nx-rust-test`)",
      "   Compiling pub-core v0.1.0 (/w/rust/target/package/pub-core-0.1.0)",
      "error[E0425]: cannot find value `missing` in this scope",
      "error: could not compile `pub-core` (lib) due to 1 previous error",
      "error: failed to verify package tarball",
    ].join("\n");
    expect(verifiedCrates(failed)).toEqual(new Set(["pub-base@0.1.0"]));
    const passed = [
      failed.split("\n").slice(0, 8).join("\n"),
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.07s",
      "   Uploading pub-base v0.1.0 (/w/rust/crates/base)",
      "warning: aborting upload due to dry run",
      "   Uploading pub-core v0.1.0 (/w/rust/crates/core)",
      "warning: aborting upload due to dry run",
    ].join("\n");
    expect(verifiedCrates(passed)).toEqual(new Set(["pub-base@0.1.0", "pub-core@0.1.0"]));
    // Packaging failed before any verification.
    expect(
      verifiedCrates(
        "   Packaging pub-core v0.1.0 (/w)\nerror: failed to prepare local package for uploading\n",
      ),
    ).toEqual(new Set());
  });

  it("reads uploads and cargo's refusals in the wording of 1.100 and 1.91", () => {
    const output = [
      "   Uploading m-a v0.1.0 (/w/ma)",
      "    Uploaded m-a v0.1.0 to registry `alpha`",
      "note: waiting for m-a v0.1.0 to be available at registry `alpha`.",
      "   Published m-a v0.1.0 at registry `alpha`",
      "   Uploading m-b v0.1.0 (/w/mb)",
      "error: unable to publish m-b v0.1.0 due to a timeout while waiting for published dependencies to be available.",
    ].join("\n");
    expect(uploadedCrates(output)).toEqual(new Set(["m-a@0.1.0"]));
    expect(
      refusedStaleLockfile(
        "error: cannot update the lock file /w/Cargo.lock because --locked was passed to prevent this",
      ),
    ).toBe(true);
    expect(
      refusedStaleLockfile(
        "error: the lock file /w/Cargo.lock needs to be updated but --locked was passed to prevent this",
      ),
    ).toBe(true);
    expect(
      refusedUncommittedChanges(
        "error: 1 files in the working directory contain changes that were not yet committed into git:",
      ),
    ).toBe(true);
    expect(
      refusedPublishList(
        "error: `rs-pla` cannot be published.\nThe registry `beta` is not listed in the `package.publish` value in Cargo.toml.",
      ),
    ).toBe(true);
    expect(refusedReplacedCratesIo("error: crates-io is replaced with remote registry cio;")).toBe(
      true,
    );
  });
});
