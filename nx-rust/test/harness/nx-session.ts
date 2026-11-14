import { ChildProcess, fork } from "node:child_process";
import { join } from "node:path";

const sessionScript = join(__dirname, "nx-session.cjs");

/** How much of a session's output an error about it shows, from the end. */
const outputKept = 20_000;

/**
 * The variable that chooses how the workspaces that ask for a session
 * ({@link FixtureWorkspace.useSession}) answer their requests: unset or
 * `on`, from the session; `off`, from a fresh process each, as every other
 * workspace does; `check`, from both, failing the test where they differ.
 * It starts with `NX_`, so that `testEnvironment` keeps it from the
 * fixtures' commands.
 */
export const sessionModeVariable = "NX_RUST_TEST_SESSIONS";

/** How the workspaces that ask for a session answer their requests ({@link sessionModeVariable}). */
export function sessionMode(): "on" | "off" | "check" {
  const mode = process.env[sessionModeVariable] || "on";
  if (mode !== "on" && mode !== "off" && mode !== "check") {
    throw new Error(`${sessionModeVariable} must be on, off or check, not ${mode}`);
  }
  return mode;
}

/** A session's reply to a request. */
export type SessionReply =
  /** The result, and what the request changed in how Node loads modules, after which the session has to end. */
  | { result: unknown; damaged?: string }
  /** The request needs a fresh process. */
  | { refused: string };

interface Pending {
  resolve(reply: SessionReply): void;
  reject(error: Error): void;
}

/**
 * A long-lived Nx process in a workspace's root that answers the requests
 * of `inspect-workspace.cjs` one after another (`nx-session.cjs`). Start it
 * with {@link NxSession.start} and end it with {@link NxSession.end}; it
 * also ends when the test process does.
 */
export class NxSession {
  private readonly pending = new Map<number, Pending>();
  private output = "";
  private requests = 0;
  private exited: string | undefined;

  private constructor(
    private readonly child: ChildProcess,
    private readonly ready: Promise<void>,
  ) {}

  /**
   * Starts a session in `root` with the environment `env`, which every
   * request has to share in the variables starting with `NX_` or `NODE_`.
   */
  static start(root: string, env: NodeJS.ProcessEnv): NxSession {
    const child = fork(sessionScript, [], {
      cwd: root,
      // glibc gives each of the native addon's threads an arena of its own,
      // which a process that stays up keeps. The variable takes effect when
      // the session starts and is not in the environment of its requests.
      env: { ...env, MALLOC_ARENA_MAX: "2" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      // As JSON, as inspect-workspace.cjs writes its result, so that a value
      // that is undefined goes missing in both.
      serialization: "json",
    });
    let session: NxSession | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      child.once("message", () => resolve());
      child.once("exit", (code, signal) =>
        reject(new Error(`The Nx session ended before it was ready (${code ?? signal}).`)),
      );
    });
    session = new NxSession(child, ready);
    const keep = (chunk: Buffer) => {
      if (session !== undefined) {
        session.output = (session.output + chunk.toString()).slice(-outputKept);
      }
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("message", (message: { id?: number }) => session?.settle(message));
    child.on("exit", (code, signal) => session?.fail(`${code ?? signal}`));
    // The test process need not wait for a session it forgot to end; the
    // session ends itself once the IPC channel closes.
    child.unref();
    child.channel?.unref();
    // An error before `ready` must not stay unhandled.
    ready.catch(() => undefined);
    return session;
  }

  /** How many requests the session has answered or is answering. */
  get requestCount(): number {
    return this.requests;
  }

  /** Answers `request` with the environment `env`. */
  async request(request: object, env: NodeJS.ProcessEnv): Promise<SessionReply> {
    await this.ready;
    if (this.exited !== undefined) {
      throw new Error(`The Nx session has ended (${this.exited}):\n${this.output}`);
    }
    const id = ++this.requests;
    const reply = new Promise<SessionReply>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.child.channel?.ref();
    try {
      this.child.send({ id, request, env });
      return await reply;
    } finally {
      this.child.channel?.unref();
    }
  }

  /** Ends the session. */
  end(): void {
    this.exited ??= "ended";
    this.child.kill("SIGKILL");
  }

  private settle(message: {
    id?: number;
    result?: unknown;
    damaged?: string;
    refused?: string;
    failed?: string;
  }): void {
    const pending = message.id === undefined ? undefined : this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(message.id as number);
    if (message.failed !== undefined) {
      pending.reject(new Error(`The Nx session failed:\n${message.failed}\n${this.output}`));
    } else if (message.refused !== undefined) {
      pending.resolve({ refused: message.refused });
    } else {
      pending.resolve({ result: message.result, damaged: message.damaged });
    }
  }

  private fail(reason: string): void {
    this.exited ??= `exited with ${reason}`;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`The Nx session ${this.exited}:\n${this.output}`));
    }
    this.pending.clear();
  }
}

/**
 * The paths, such as `hashes > api:test > value`, of the values that differ
 * between `a` and `b`, compared value by value.
 */
export function differingPaths(a: unknown, b: unknown, path = ""): string[] {
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((key) =>
      differingPaths(a[key], b[key], path === "" ? key : `${path} > ${key}`),
    );
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((value, index) => differingPaths(value, b[index], `${path}[${index}]`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
