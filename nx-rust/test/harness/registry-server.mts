/**
 * The server of the tests' sparse Cargo registry, which {@link SparseRegistry}
 * in `sparse-registry.ts` runs in a Node process of its own, so that a test
 * that runs cargo synchronously, as with `spawnSync`, does not block the
 * server that cargo talks to.
 *
 * Node runs this file as it is, removing the types, so it uses only syntax
 * that can be erased, such as no parameter properties and no enums, and
 * imports nothing but Node's own modules at run time.
 * The `typecheck` target checks it with the rest of the harness.
 *
 * It listens on 127.0.0.1, on a port that the system picks, and serves the
 * sparse protocol and the publish endpoint of Cargo's registry web API:
 *
 * - `GET /index/config.json` names the downloads and the API on this server;
 * - `GET /index/<prefix>/<name>` serves the index file of a crate from the
 *   folder `index`, and 404 where there is none;
 * - `GET /api/v1/crates/<name>/<version>/download` serves a `.crate` file
 *   from the folder `crates`;
 * - `PUT /api/v1/crates/new` takes what `cargo publish` uploads.
 *
 * An upload needs the registry's token in the `Authorization` header, as
 * cargo sends it, and is refused with 403 otherwise. A version that the
 * registry already has, in its index or waiting to be shown there, is
 * refused with 400 and the message with which crates.io refuses it. An
 * accepted upload is written to `crates` and logged in `uploads.jsonl`, and
 * its line is appended to the index after the index delay, or never. Every
 * request is logged in `requests.jsonl` before it is answered, so that the
 * log is complete once the cargo that sent it has exited.
 *
 * {@link SparseRegistry} makes this server cargo's HTTP proxy, so that no
 * HTTP or HTTPS request of cargo's reaches another host: a request for
 * another host is refused with 403, a `CONNECT` tunnel too, and both are
 * logged.
 *
 * Arguments: the registry's folder, the token and the index delay in
 * milliseconds or `never`. The process sends {@link ServerMessage}s and takes
 * {@link ParentMessage}s through its IPC channel, and exits when asked to
 * stop or when its parent goes away.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { dirname, join } from "node:path";

/** What the server sends to the process that started it. */
export type ServerMessage =
  | { type: "listening"; port: number }
  | { type: "settings-applied" }
  | { type: "failed"; message: string };

/** What the process that started the server sends to it. */
export type ParentMessage =
  /** `indexDelay` is in milliseconds, `null` for never. */
  { type: "settings"; indexDelay: number | null } | { type: "stop" };

/** A dependency as `cargo publish` describes it in its upload. */
export interface PublishDependency {
  /** The package's name, also where the manifest renames it. */
  name: string;
  version_req: string;
  features: string[];
  optional: boolean;
  default_features: boolean;
  target: string | null;
  kind: "normal" | "build" | "dev";
  /** The index URL of the dependency's registry; absent or `null` for the registry it is published to. */
  registry?: string | null;
  /** The name under which the manifest uses the package, where it renames it. */
  explicit_name_in_toml?: string | null;
}

/** The metadata of an upload, the JSON part of what `cargo publish` sends. */
export interface PublishMetadata {
  name: string;
  vers: string;
  deps: PublishDependency[];
  features: Record<string, string[]>;
  links?: string | null;
  rust_version?: string | null;
  [field: string]: unknown;
}

/** A dependency in an index line. */
export interface IndexDependency {
  /** The name the dependent uses for it. */
  name: string;
  req: string;
  features: string[];
  optional: boolean;
  default_features: boolean;
  target: string | null;
  kind: "normal" | "build" | "dev";
  registry?: string | null;
  /** The package's name, where `name` renames it. */
  package?: string;
}

/** A line of a crate's index file: one version. */
export interface IndexEntry {
  name: string;
  vers: string;
  deps: IndexDependency[];
  cksum: string;
  features: Record<string, string[]>;
  yanked: boolean;
  links?: string | null;
  rust_version?: string;
}

/** A line of `uploads.jsonl`: an upload that the registry accepted. */
export interface RegistryUpload {
  name: string;
  vers: string;
  /** The metadata as cargo sent it. */
  metadata: PublishMetadata;
  /** The SHA-256 of the `.crate` file, as the index gives it. */
  cksum: string;
  /** The path of the `.crate` file. */
  crateFile: string;
  /** When the registry accepted the upload, in milliseconds since the epoch. */
  receivedAt: number;
}

/** A line of `requests.jsonl`. */
export interface RegistryRequest {
  method: string;
  /** The URL as the request named it: a path, or an absolute URL or `host:port` where it went to the proxy. */
  url: string;
  status: number;
  /** The `Authorization` header, `null` without one. */
  authorization: string | null;
}

/** The path of a crate's index file below the index root, as Cargo lays it out by the length of the lowercased name. */
function indexPath(name: string): string[] {
  const lower = name.toLowerCase();
  switch (lower.length) {
    case 1:
      return ["1", lower];
    case 2:
      return ["2", lower];
    case 3:
      return ["3", lower.slice(0, 1), lower];
    default:
      return [lower.slice(0, 2), lower.slice(2, 4), lower];
  }
}

/** The path of a version's `.crate` file below the registry's folder. */
function crateFilePath(name: string, version: string): string[] {
  return ["crates", name.toLowerCase(), `${version}.crate`];
}

/** The index line of an upload. */
function uploadEntry(metadata: PublishMetadata, cksum: string): IndexEntry {
  return {
    name: metadata.name,
    vers: metadata.vers,
    deps: metadata.deps.map((dependency) => ({
      name: dependency.explicit_name_in_toml ?? dependency.name,
      req: dependency.version_req,
      features: dependency.features,
      optional: dependency.optional,
      default_features: dependency.default_features,
      target: dependency.target,
      kind: dependency.kind,
      registry: dependency.registry ?? null,
      ...(dependency.explicit_name_in_toml ? { package: dependency.name } : {}),
    })),
    cksum,
    features: metadata.features,
    yanked: false,
    links: metadata.links ?? null,
    ...(metadata.rust_version ? { rust_version: metadata.rust_version } : {}),
  };
}

/** A crate name as Cargo accepts one; anything else never reaches the file system. */
const crateName = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** A version as Cargo writes one, with pre-release and build parts. */
const crateVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** What the server answers to a request. */
interface Reply {
  status: number;
  type: string;
  body: string | Buffer;
}

/** A reply with a JSON body. */
function json(status: number, body: unknown): Reply {
  return { status, type: "application/json", body: JSON.stringify(body) };
}

/** A request the registry refuses, with the status and the message that cargo shows. */
class Refusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class Registry {
  /** Uploads not shown in the index yet, by `name@version` without build metadata. */
  private readonly waiting = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  /** In milliseconds; `null` for never. */
  indexDelay: number | null;
  port = 0;
  private readonly folder: string;
  private readonly token: string;

  constructor(folder: string, token: string, indexDelay: number | null) {
    this.folder = folder;
    this.token = token;
    this.indexDelay = indexDelay;
  }

  /** Answers a request whose target is this server. */
  async handle(request: IncomingMessage, path: string): Promise<Reply> {
    const [route] = path.split("?");
    if (request.method === "GET" && route === "/index/config.json") {
      const base = `http://127.0.0.1:${this.port}`;
      return json(200, { dl: `${base}/api/v1/crates`, api: base });
    }
    if (request.method === "GET" && route.startsWith("/index/")) {
      return this.indexFile(route.slice("/index/".length));
    }
    const download = /^\/api\/v1\/crates\/([^/]+)\/([^/]+)\/download$/.exec(route);
    if (request.method === "GET" && download) {
      return this.download(download[1], download[2]);
    }
    if (request.method === "PUT" && route === "/api/v1/crates/new") {
      return this.publish(request);
    }
    throw new Refusal(404, `the test registry has nothing at ${request.method} ${route}`);
  }

  private indexFile(path: string): Reply {
    const segments = path.split("/");
    const name = segments.at(-1) ?? "";
    if (!crateName.test(name) || segments.join("/") !== indexPath(name).join("/")) {
      throw new Refusal(404, `no index file at ${path}`);
    }
    const file = join(this.folder, "index", ...segments);
    if (!existsSync(file)) {
      throw new Refusal(404, `no crate named ${name}`);
    }
    return { status: 200, type: "text/plain; charset=utf-8", body: readFileSync(file) };
  }

  private download(name: string, version: string): Reply {
    const file = join(this.folder, ...crateFilePath(name, version));
    if (!crateName.test(name) || !crateVersion.test(version) || !existsSync(file)) {
      throw new Refusal(404, `no file for ${name}@${version}`);
    }
    return { status: 200, type: "application/octet-stream", body: readFileSync(file) };
  }

  private async publish(request: IncomingMessage): Promise<Reply> {
    if (request.headers.authorization !== this.token) {
      throw new Refusal(403, "authentication failed: the test registry takes only its own token");
    }
    const body = await readBody(request);
    const { metadata, crate } = parseUpload(body);
    const key = versionKey(metadata.name, metadata.vers);
    if (this.waiting.has(key) || this.indexed(metadata.name).has(key)) {
      // What crates.io answers, with the version without build metadata.
      throw new Refusal(
        400,
        `crate version \`${metadata.vers.split("+")[0]}\` is already uploaded`,
      );
    }
    const crateFile = join(this.folder, ...crateFilePath(metadata.name, metadata.vers));
    mkdirSync(dirname(crateFile), { recursive: true });
    writeFileSync(crateFile, crate);
    const cksum = createHash("sha256").update(crate).digest("hex");
    const upload: RegistryUpload = {
      name: metadata.name,
      vers: metadata.vers,
      metadata,
      cksum,
      crateFile,
      receivedAt: Date.now(),
    };
    appendFileSync(join(this.folder, "uploads.jsonl"), `${JSON.stringify(upload)}\n`);
    this.show(uploadEntry(metadata, cksum), key);
    return json(200, { warnings: { invalid_categories: [], invalid_badges: [], other: [] } });
  }

  /** Appends the entry to the index after the index delay, or never. */
  private show(entry: IndexEntry, key: string): void {
    const delay = this.indexDelay;
    const append = () =>
      appendIndexLine(join(this.folder, "index", ...indexPath(entry.name)), entry);
    if (delay === 0) {
      append();
      return;
    }
    this.waiting.add(key);
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.waiting.delete(key);
      append();
    }, delay);
    this.timers.add(timer);
  }

  /** The versions in a crate's index file. */
  private indexed(name: string): Set<string> {
    const file = join(this.folder, "index", ...indexPath(name));
    if (!existsSync(file)) {
      return new Set();
    }
    return new Set(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const entry = JSON.parse(line) as IndexEntry;
          return versionKey(entry.name, entry.vers);
        }),
    );
  }

  stopTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

/** Appends one line to an index file, creating it where needed. */
function appendIndexLine(file: string, entry: IndexEntry): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** Versions that differ in build metadata only are one version to a registry. */
function versionKey(name: string, version: string): string {
  return `${name.toLowerCase().replace(/_/g, "-")}@${version.split("+")[0]}`;
}

/**
 * Splits an upload: a 32-bit little-endian length and the JSON metadata, then
 * a length and the `.crate` file.
 */
function parseUpload(body: Buffer): { metadata: PublishMetadata; crate: Buffer } {
  const invalid = new Refusal(400, "the upload is not in the format of cargo publish");
  if (body.length < 4) {
    throw invalid;
  }
  const jsonLength = body.readUInt32LE(0);
  if (body.length < 8 + jsonLength) {
    throw invalid;
  }
  const crateLength = body.readUInt32LE(4 + jsonLength);
  if (body.length !== 8 + jsonLength + crateLength) {
    throw invalid;
  }
  let metadata: PublishMetadata;
  try {
    metadata = JSON.parse(body.subarray(4, 4 + jsonLength).toString("utf8")) as PublishMetadata;
  } catch {
    throw invalid;
  }
  if (
    typeof metadata?.name !== "string" ||
    !crateName.test(metadata.name) ||
    typeof metadata.vers !== "string" ||
    !crateVersion.test(metadata.vers) ||
    !Array.isArray(metadata.deps)
  ) {
    throw invalid;
  }
  return { metadata, crate: body.subarray(8 + jsonLength) };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** The reply to a request, which names the whole URL where it came through the proxy. */
async function reply(registry: Registry, request: IncomingMessage): Promise<Reply> {
  let path = request.url ?? "/";
  // Only requests for this server itself pass the proxy.
  if (!path.startsWith("/")) {
    let url: URL | undefined;
    try {
      url = new URL(path);
    } catch {
      // Not a URL.
    }
    if (url?.protocol !== "http:" || url.host !== `127.0.0.1:${registry.port}`) {
      return json(403, {
        errors: [{ detail: `the test registry refuses to forward a request to ${path}` }],
      });
    }
    path = `${url.pathname}${url.search}`;
  }
  try {
    return await registry.handle(request, path);
  } catch (error) {
    const status = error instanceof Refusal ? error.status : 500;
    if (status === 500) {
      console.error(error);
    }
    return json(status, { errors: [{ detail: (error as Error).message }] });
  }
}

function main(): void {
  const [folder, token, delay] = process.argv.slice(2);
  if (!folder || !token || !delay || !process.send) {
    throw new Error("usage: registry-server.mts <folder> <token> <milliseconds|never>, with IPC");
  }
  const tell = (message: ServerMessage) => process.send?.(message);
  const registry = new Registry(folder, token, delay === "never" ? null : Number(delay));
  const log = (request: IncomingMessage, status: number) =>
    appendFileSync(
      join(folder, "requests.jsonl"),
      `${JSON.stringify({
        method: request.method ?? "",
        url: request.url ?? "",
        status,
        authorization: request.headers.authorization ?? null,
      } satisfies RegistryRequest)}\n`,
    );

  const server = createServer((request, response: ServerResponse) => {
    void reply(registry, request).then(({ status, type, body }) => {
      // Logged before the answer, so that the log is complete when cargo exits.
      log(request, status);
      response.writeHead(status, { "content-type": type });
      response.end(body);
    });
  });
  // A tunnel, as for an HTTPS URL through the proxy, goes nowhere.
  server.on("connect", (request: IncomingMessage, socket: Socket) => {
    log(request, 403);
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });

  const stop = () => {
    registry.stopTimers();
    server.close();
    server.closeAllConnections();
    process.exit(0);
  };
  process.on("message", (message: ParentMessage) => {
    if (message.type === "stop") {
      stop();
    } else if (message.type === "settings") {
      registry.indexDelay = message.indexDelay;
      tell({ type: "settings-applied" });
    }
  });
  process.on("disconnect", stop);
  server.on("error", (error) => {
    tell({ type: "failed", message: error.message });
    process.exit(1);
  });
  server.listen(0, "127.0.0.1", () => {
    registry.port = (server.address() as AddressInfo).port;
    tell({ type: "listening", port: registry.port });
  });
}

main();
