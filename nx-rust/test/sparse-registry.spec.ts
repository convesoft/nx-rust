import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  HARNESS_TIMEOUT,
  pinnedToolchain,
  pinnedToolchainAvailable,
  shortPublishTimeout,
  SparseRegistry,
  SparseRegistryOptions,
  testEnvironment,
  testRunFolder,
} from "./harness";

// Checks the harness's sparse registry, which the tests of VER-RELEASE
// publish to in place of crates.io, against the real cargo of the default
// toolchain and of 1.91, the oldest that the plugin supports.

/** What a cargo call returned. */
interface CargoResult {
  status: number | null;
  /** Standard output and error. */
  output: string;
}

/**
 * The toolchains whose cargo the publishing checks run, with what their
 * `cargo --version` starts with: the default one, the latest stable in CI,
 * and 1.91 where rustup has it, as CI does.
 */
const toolchains: [string, Record<string, string>, RegExp][] = [
  ["the default toolchain", {}, /^cargo \d+\.\d+\.\d+ /],
  ...(pinnedToolchainAvailable()
    ? [
        [
          `Cargo ${pinnedToolchain}`,
          { RUSTUP_TOOLCHAIN: pinnedToolchain },
          new RegExp(`^cargo ${pinnedToolchain.replace(/\./g, "\\.")} `),
        ] as [string, Record<string, string>, RegExp],
      ]
    : []),
];

/** The registry's name in its Cargo home. */
const registryName = SparseRegistry.registryName;

/** How cargo names a dependency's registry when that registry is crates.io, replaced or not. */
const cratesIoIndex = "https://github.com/rust-lang/crates.io-index";

/** A crate's manifest, with the fields that crates.io asks for. */
function manifest(name: string, version: string, dependencies = ""): string {
  return [
    "[package]",
    `name = "${name}"`,
    `version = "${version}"`,
    'edition = "2021"',
    `description = "A crate of the registry's tests"`,
    'license = "MIT"',
    ...(dependencies === "" ? [] : ["", "[dependencies]", dependencies]),
    "",
  ].join("\n");
}

/** A workspace of `rega` and `regb`, which depends on it by path with a version requirement. */
const twoCrates: Record<string, string> = {
  "Cargo.toml": '[workspace]\nmembers = ["a", "b"]\nresolver = "2"\n',
  "a/Cargo.toml": manifest("rega", "0.1.0"),
  "a/src/lib.rs": "pub fn a() -> u32 {\n    1\n}\n",
  "b/Cargo.toml": manifest("regb", "0.1.0", 'rega = { path = "../a", version = "0.1.0" }'),
  "b/src/lib.rs": "pub fn b() -> u32 {\n    rega::a() + 1\n}\n",
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Runs cargo and waits for it, which the registry's own process allows. */
function cargo(cwd: string, args: string[], env: Record<string, string | undefined>): CargoResult {
  const result = spawnSync("cargo", args, { cwd, env: testEnvironment(env), encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Starts cargo and resolves once it has exited. */
function startCargo(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<CargoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", args, {
      cwd,
      env: testEnvironment(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

/** Resolves to what `read` returns once that is defined. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > end) {
      throw new Error(`Gave up waiting after ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A server that stands in for another host, with what each connection to it sent. */
interface OtherHost {
  port: number;
  /** What each connection sent before the server closed it, "" where it sent nothing. */
  connections: string[];
  close(): Promise<void>;
}

/**
 * Listens on the loopback interface, on a port of its own, so that a test
 * can aim cargo at another host without a network, and records every
 * connection: one that reaches it would have reached the other host. It
 * closes each connection after the first data or half a second.
 */
async function otherHost(): Promise<OtherHost> {
  const connections: string[] = [];
  const server = createServer((socket) => {
    const index = connections.push("") - 1;
    socket.on("data", (chunk: Buffer) => {
      connections[index] += chunk.toString("latin1");
      socket.destroy();
    });
    socket.on("error", () => undefined);
    socket.setTimeout(500, () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connections,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Lets connections that a finished cargo opened arrive before a test counts them. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

describe("SparseRegistry", () => {
  const registries: SparseRegistry[] = [];
  const folders: string[] = [];
  const hosts: OtherHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.close()));
    await Promise.all(registries.splice(0).map((registry) => registry.remove()));
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  async function startOtherHost(): Promise<OtherHost> {
    const host = await otherHost();
    hosts.push(host);
    return host;
  }

  async function start(options?: SparseRegistryOptions): Promise<SparseRegistry> {
    const registry = await SparseRegistry.start(options);
    registries.push(registry);
    return registry;
  }

  /** A folder with `files` in the test run's folder, deleted after the test. */
  function workspace(files: Record<string, string>): string {
    const root = realpathSync(
      mkdtempSync(join(testRunFolder() ?? tmpdir(), "registry-workspace-")),
    );
    folders.push(root);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  it(
    "listens on 127.0.0.1 on a port that the system picks, so that registries run side by side",
    async () => {
      const [first, second] = await Promise.all([start(), start()]);
      expect(first.port).not.toBe(second.port);
      for (const registry of [first, second]) {
        expect(registry.url).toBe(`http://127.0.0.1:${registry.port}`);
        const response = await fetch(`${registry.url}/index/config.json`);
        expect(await response.json()).toEqual({
          dl: `${registry.url}/api/v1/crates`,
          api: registry.url,
        });
        expect(readFileSync(join(registry.cargoHome, "config.toml"), "utf8")).toBe(
          [
            `[registries.${registryName}]`,
            `index = "sparse+${registry.url}/index/"`,
            "",
            "[registry]",
            `default = "${registryName}"`,
            "",
            "[source.crates-io]",
            `replace-with = "${registryName}"`,
            "",
            "# Every request goes through the registry, which refuses other hosts.",
            "[http]",
            `proxy = "${registry.url}"`,
            "",
          ].join("\n"),
        );
        expect(readFileSync(join(registry.cargoHome, "credentials.toml"), "utf8")).toBe(
          `[registries.${registryName}]\ntoken = "${registry.token}"\n`,
        );
      }
      expect(first.token).not.toBe(second.token);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "resolves a crate name that crates.io has against its own index only",
    async () => {
      const registry = await start();
      registry.seed({ name: "serde", version: "1.0.0" });
      const root = workspace({
        "Cargo.toml": manifest("consumer", "0.1.0", 'serde = "1"'),
        "src/lib.rs": "",
      });

      const locked = cargo(root, ["generate-lockfile"], registry.env());
      expect(locked).toMatchObject({ status: 0 });
      // crates.io has later 1.x versions; the replaced source keeps crates.io's name.
      expect(readFileSync(join(root, "Cargo.lock"), "utf8")).toContain(
        `name = "serde"\nversion = "1.0.0"\nsource = "registry+${cratesIoIndex}"\n`,
      );
      expect(registry.requests()).toContainEqual({
        method: "GET",
        url: `${registry.url}/index/se/rd/serde`,
        status: 200,
        authorization: null,
      });

      // A crate that crates.io has and this index does not is not found.
      writeFileSync(join(root, "Cargo.toml"), manifest("consumer", "0.1.0", 'rand = "0.8"'));
      const missing = cargo(root, ["generate-lockfile"], registry.env());
      expect(missing.status).toBe(101);
      expect(missing.output).toContain("no matching package named `rand` found");
      expect(missing.output).toContain(
        `\`${registryName}\` index (which is replacing registry \`crates-io\`)`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "refuses every other host, also crates.io named with --registry, and keeps no_proxy from bypassing it",
    async () => {
      const registry = await start();
      const root = workspace({ "Cargo.toml": manifest("rega", "0.1.0"), "src/lib.rs": "" });
      // Without retries, which only repeat the refusal.
      const once = ["--config", "net.retry=0"];

      // `--registry crates-io` does not follow source replacement.
      const cratesIo = cargo(
        root,
        [...once, "publish", "--dry-run", "--no-verify", "--registry", "crates-io"],
        registry.env(),
      );
      expect(cratesIo.status).toBe(101);
      expect(cratesIo.output).toContain("CONNECT tunnel failed, response 403");
      expect(registry.requests()).toEqual([
        { method: "CONNECT", url: "index.crates.io:443", status: 403, authorization: null },
      ]);

      // `no_proxy` in the developer's shell would let curl go straight to the host.
      const saved = { no_proxy: process.env.no_proxy, NO_PROXY: process.env.NO_PROXY };
      process.env.no_proxy = "*";
      process.env.NO_PROXY = "*";
      let other: CargoResult;
      try {
        other = cargo(
          root,
          [
            ...once,
            "publish",
            "--dry-run",
            "--no-verify",
            "--index",
            "sparse+https://registry.invalid/",
          ],
          registry.env(),
        );
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
      }
      expect(other.status).toBe(101);
      expect(other.output).toContain("CONNECT tunnel failed, response 403");
      expect(registry.requests().at(-1)).toEqual({
        method: "CONNECT",
        url: "registry.invalid:443",
        status: 403,
        authorization: null,
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "seeds versions, with a .crate file against which cargo builds and without one",
    async () => {
      const registry = await start();
      // Packaging a crate with a dependency asks the registry while the test waits for cargo.
      registry.seed(
        { name: "base", version: "1.0.0", source: "pub fn base() -> u32 {\n    40\n}\n" },
        { crateFile: true },
      );
      const seeded = registry.seed(
        {
          name: "seeded",
          version: "1.0.0",
          dependencies: [{ name: "base", req: "^1" }],
          source: "pub fn answer() -> u32 {\n    base::base() + 2\n}\n",
        },
        { crateFile: true },
      );
      registry.seed({ name: "seeded", version: "1.1.0" });
      expect(() => registry.seed({ name: "seeded", version: "1.1.0" })).toThrow(
        "already has seeded@1.1.0",
      );
      expect(registry.index("seeded")).toEqual([
        seeded,
        expect.objectContaining({ name: "seeded", vers: "1.1.0", deps: [] }),
      ]);
      expect(seeded.deps).toEqual([expect.objectContaining({ name: "base", req: "^1" })]);
      expect((await fetch(`${registry.url}/api/v1/crates/seeded/1.1.0/download`)).status).toBe(404);

      // Resolution sees the newer version, which has no file.
      const root = workspace({
        "Cargo.toml": manifest("consumer", "0.1.0", 'seeded = "1"'),
        "src/lib.rs": "pub fn consume() -> u32 {\n    seeded::answer()\n}\n",
      });
      expect(cargo(root, ["generate-lockfile"], registry.env())).toMatchObject({ status: 0 });
      expect(readFileSync(join(root, "Cargo.lock"), "utf8")).toContain(
        'name = "seeded"\nversion = "1.1.0"\n',
      );

      // Cargo downloads the version with a file, checks its checksum and builds against it.
      writeFileSync(join(root, "Cargo.toml"), manifest("consumer", "0.1.0", 'seeded = "=1.0.0"'));
      expect(cargo(root, ["build"], registry.env())).toMatchObject({ status: 0 });
      expect(registry.requests()).toEqual(
        expect.arrayContaining(
          ["base", "seeded"].map((name) => ({
            method: "GET",
            url: `${registry.url}/api/v1/crates/${name}/1.0.0/download`,
            status: 200,
            authorization: null,
          })),
        ),
      );
    },
    HARNESS_TIMEOUT,
  );

  describe.each(toolchains)("with %s", (_, toolchain, version) => {
    it("runs that cargo", () => {
      expect(cargo(tmpdir(), ["--version"], toolchain).output).toMatch(version);
    });

    it(
      "takes two dependent crates from one cargo publish, and its index lists both",
      async () => {
        const registry = await start();
        const root = workspace(twoCrates);
        const env = { ...registry.env(), ...toolchain };

        expect(cargo(root, ["publish", "-p", "rega", "-p", "regb"], env)).toMatchObject({
          status: 0,
        });

        const uploads = registry.uploads();
        expect(uploads.map((upload) => `${upload.name}@${upload.vers}`)).toEqual([
          "rega@0.1.0",
          "regb@0.1.0",
        ]);
        // What cargo sends for a path dependency with a version requirement.
        expect(uploads[1].metadata.deps).toEqual([
          {
            name: "rega",
            version_req: "^0.1.0",
            features: [],
            optional: false,
            default_features: true,
            target: null,
            kind: "normal",
            registry: cratesIoIndex,
          },
        ]);
        for (const upload of uploads) {
          expect(upload.cksum).toBe(sha256(readFileSync(upload.crateFile)));
        }
        expect(registry.index("rega")).toEqual([
          {
            name: "rega",
            vers: "0.1.0",
            deps: [],
            cksum: uploads[0].cksum,
            features: {},
            yanked: false,
            links: null,
          },
        ]);
        expect(registry.index("regb")).toEqual([
          {
            name: "regb",
            vers: "0.1.0",
            deps: [
              {
                name: "rega",
                req: "^0.1.0",
                features: [],
                optional: false,
                default_features: true,
                target: null,
                kind: "normal",
                registry: cratesIoIndex,
              },
            ],
            cksum: uploads[1].cksum,
            features: {},
            yanked: false,
            links: null,
          },
        ]);
        // Cargo sends the token with the uploads and with nothing else.
        expect(registry.requests().filter((request) => request.authorization !== null)).toEqual(
          uploads.map(() => ({
            method: "PUT",
            url: `${registry.url}/api/v1/crates/new`,
            status: 200,
            authorization: registry.token,
          })),
        );

        // Cargo reads both back, as the plugin's check before a publish does.
        for (const name of ["rega", "regb"]) {
          const info = cargo(root, ["info", `${name}@0.1.0`, "--registry", registryName], env);
          expect(info).toMatchObject({ status: 0 });
          expect(info.output).toContain("version: 0.1.0");
        }
        const missing = cargo(root, ["info", "rega@0.1.1", "--registry", registryName], env);
        expect(missing.status).toBe(101);
        expect(missing.output).toContain("could not find `rega@0.1.1`");
      },
      HARNESS_TIMEOUT,
    );

    it(
      "lists a seeded version, which cargo then refuses to upload",
      async () => {
        const registry = await start();
        const root = workspace(twoCrates);
        registry.seed({ name: "rega", version: "0.1.0" });

        const existing = cargo(root, ["publish", "-p", "rega", "--no-verify"], {
          ...registry.env(),
          ...toolchain,
        });
        expect(existing.status).toBe(101);
        expect(existing.output).toContain(
          `crate rega@0.1.0 already exists on \`${registryName}\` index`,
        );
        expect(registry.requests().filter((request) => request.method === "PUT")).toEqual([]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "never shows an upload with an index delay of Infinity, so that cargo's wait times out, and refuses that version again",
      async () => {
        const registry = await start();
        await registry.setIndexDelay(Infinity);
        const root = workspace(twoCrates);
        const env = { ...registry.env(), ...toolchain, ...shortPublishTimeout(1) };

        const timedOut = cargo(root, ["publish", "-p", "rega", "-p", "regb"], env);
        expect(timedOut.status).toBe(101);
        expect(timedOut.output).toContain("timed out waiting for rega v0.1.0");
        expect(timedOut.output).toContain(
          "unable to publish regb v0.1.0 due to a timeout while waiting for published dependencies",
        );
        expect(registry.uploads().map((upload) => upload.name)).toEqual(["rega"]);
        expect(registry.index("rega")).toEqual([]);

        // Cargo does not find it in the index and uploads it again; crates.io's refusal.
        const again = cargo(root, ["publish", "-p", "rega", "--no-verify"], env);
        expect(again.status).toBe(101);
        expect(again.output).toContain(
          "the remote server responded with an error (status 400 Bad Request): crate version `0.1.0` is already uploaded",
        );
        expect(registry.uploads()).toHaveLength(1);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "shows an upload in its index only after the index delay, while cargo waits for it",
      async () => {
        const indexDelay = 2_000;
        const registry = await start({ indexDelay });
        const root = workspace(twoCrates);

        const publishing = startCargo(root, ["publish", "-p", "rega", "--no-verify"], {
          ...registry.env(),
          ...toolchain,
        });
        const upload = await waitFor(() => registry.uploads()[0]);
        expect(registry.index("rega")).toEqual([]);
        expect((await fetch(`${registry.url}/index/re/ga/rega`)).status).toBe(404);

        const published = await publishing;
        const finished = Date.now();
        expect(published).toMatchObject({ status: 0 });
        expect(published.output).toContain("waiting for rega v0.1.0 to be available");
        expect(published.output).toContain("Published rega v0.1.0");
        expect(finished - upload.receivedAt).toBeGreaterThanOrEqual(indexDelay);
        expect(registry.index("rega").map((entry) => entry.vers)).toEqual(["0.1.0"]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "keeps cargo from other hosts although a configuration file above the working folder switches the guard off",
      async () => {
        const registry = await start();
        const other = await startOtherHost();
        const elsewhere = `sparse+http://127.0.0.1:${other.port}/`;
        const outer = workspace({
          "repo/Cargo.toml": manifest("rega", "0.1.0"),
          "repo/src/lib.rs": "",
        });
        const ran = join(outer, "provider-ran");
        const provider = join(outer, "provider.sh");
        writeFileSync(provider, `#!/bin/sh\necho ran >> '${ran}'\nexit 1\n`);
        chmodSync(provider, 0o755);
        // Takes precedence over the Cargo home, as ~/.cargo/config.toml does
        // where the temporary folder lies below the home folder.
        mkdirSync(join(outer, ".cargo"));
        writeFileSync(
          join(outer, ".cargo", "config.toml"),
          [
            "[http]",
            'proxy = ""',
            "",
            "[net]",
            "offline = true",
            "",
            "[registry]",
            'default = "elsewhere"',
            `global-credential-providers = [${JSON.stringify(provider)}]`,
            "",
            "[registries.elsewhere]",
            `index = "${elsewhere}"`,
            "",
            `[registries.${registryName}]`,
            `index = "${elsewhere}"`,
            'token = "not-the-token"',
            `credential-provider = [${JSON.stringify(provider)}]`,
            "",
          ].join("\n"),
        );
        const root = join(outer, "repo");
        const env = { ...registry.env(), ...toolchain };

        const aimed = await startCargo(
          root,
          ["--config", "net.retry=0", "publish", "--dry-run", "--no-verify", "--index", elsewhere],
          env,
        );
        await settle();
        expect(other.connections).toEqual([]);
        expect(aimed.status).toBe(101);
        expect(registry.requests()).toContainEqual({
          method: "GET",
          url: `http://127.0.0.1:${other.port}/config.json`,
          status: 403,
          authorization: null,
        });

        // The Cargo home's registry, index and token, and no credential provider of the file.
        expect(await startCargo(root, ["publish", "--no-verify"], env)).toMatchObject({
          status: 0,
        });
        expect(registry.uploads().map((upload) => upload.name)).toEqual(["rega"]);
        expect(existsSync(ran)).toBe(false);

        await settle();
        expect(other.connections).toEqual([]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "fetches git repositories from local files only, so that git://, ssh:// and git over https reach no other host",
      async () => {
        const registry = await start();
        const other = await startOtherHost();
        const host = `127.0.0.1:${other.port}`;
        const local = workspace({ "Cargo.toml": manifest("localdep", "0.1.0"), "src/lib.rs": "" });
        for (const args of [
          ["init", "-q"],
          ["add", "-A"],
          ["commit", "-q", "-m", "localdep"],
        ]) {
          const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
            cwd: local,
            env: testEnvironment(),
            encoding: "utf8",
          });
          expect(result).toMatchObject({ status: 0 });
        }
        // Takes precedence over the Cargo home; the environment pins it back.
        const outer = workspace({
          ".cargo/config.toml": "[net]\ngit-fetch-with-cli = false\n",
          "repo/Cargo.toml": manifest("rega", "0.1.0"),
          "repo/src/lib.rs": "",
        });
        const root = join(outer, "repo");
        const env = { ...registry.env(), ...toolchain };
        const once = ["--config", "net.retry=0"];
        const resolveWith = (dependency: string) => {
          writeFileSync(join(root, "Cargo.toml"), manifest("rega", "0.1.0", dependency));
          rmSync(join(root, "Cargo.lock"), { force: true });
          return startCargo(root, [...once, "generate-lockfile"], env);
        };

        const refused: [string, CargoResult][] = [];
        refused.push([
          "git",
          await startCargo(
            root,
            [...once, "publish", "--dry-run", "--no-verify", "--index", `git://${host}/index`],
            env,
          ),
        ]);
        refused.push(["git", await resolveWith(`dep = { git = "git://${host}/dep" }`)]);
        refused.push(["ssh", await resolveWith(`dep = { git = "ssh://git@${host}/dep" }`)]);
        refused.push(["https", await resolveWith(`dep = { git = "https://${host}/dep" }`)]);
        refused.push([
          "ssh",
          await startCargo(
            root,
            [
              ...once,
              "install",
              "--root",
              join(outer, "installed"),
              "--git",
              `ssh://git@${host}/x`,
            ],
            env,
          ),
        ]);
        await settle();
        expect(other.connections).toEqual([]);
        for (const [transport, result] of refused) {
          expect(result).toMatchObject({ status: 101 });
          expect(result.output).toContain(`transport '${transport}' not allowed`);
        }

        // A git dependency on local files still resolves.
        expect(await resolveWith(`localdep = { git = "file://${local}" }`)).toMatchObject({
          status: 0,
        });
        expect(readFileSync(join(root, "Cargo.lock"), "utf8")).toContain(
          `source = "git+file://${local}#`,
        );

        await settle();
        expect(other.connections).toEqual([]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "takes an upload only with its own token",
      async () => {
        const registry = await start();
        const root = workspace(twoCrates);

        const refused = cargo(root, ["publish", "-p", "rega", "--no-verify"], {
          ...registry.env(),
          ...toolchain,
          CARGO_REGISTRIES_NX_RUST_TEST_TOKEN: "not-the-token",
        });
        expect(refused.status).toBe(101);
        expect(refused.output).toContain("(status 403 Forbidden): authentication failed");
        expect(registry.uploads()).toEqual([]);
        expect(registry.requests().filter((request) => request.method === "PUT")).toEqual([
          {
            method: "PUT",
            url: `${registry.url}/api/v1/crates/new`,
            status: 403,
            authorization: "not-the-token",
          },
        ]);
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    "keeps its files in the test run's folder until it is removed, and stops answering when stopped",
    async () => {
      const registry = await SparseRegistry.start();
      try {
        const run = testRunFolder();
        expect(run).toBeDefined();
        expect(registry.base.startsWith(`${run}/`)).toBe(true);
        expect(registry.cargoHome.startsWith(`${registry.base}/`)).toBe(true);

        await registry.stop();
        await expect(fetch(`${registry.url}/index/config.json`)).rejects.toThrow("fetch failed");
        expect(existsSync(join(registry.cargoHome, "config.toml"))).toBe(true);
      } finally {
        await registry.remove();
      }
      expect(existsSync(registry.base)).toBe(false);
    },
    HARNESS_TIMEOUT,
  );
});
