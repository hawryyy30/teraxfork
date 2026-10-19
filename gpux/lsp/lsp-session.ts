// Bun port of Terax's Rust lsp_* dumb pipe
// (~/workspace/terax-ai/src-tauri/src/modules/lsp/{mod,session,env}.rs).
// The host owns process lifecycle and Content-Length framing only;
// protocol intelligence stays on the caller, mirroring the Rust design.
//
// Divergences from the Rust host, all noted for the real port:
// - kill() terminates the child only. The Rust host puts the server in its
//   own process group and group-kills (servers fork helpers like cargo
//   check). Bun.spawn has no setsid option; the real port needs a small
//   setsid wrapper or node child_process with detached:true.
// - No RSS policing yet (Rust polls rss_bytes with a startup grace and a
//   4 GB default budget). Bun can read /proc/<pid>/status on Linux.
// - Server env overlay: Terax captures the login-shell env because GUI apps
//   get a bare PATH on macOS (lsp/env.rs). Here we inherit process.env,
//   which is correct for a Bun host launched from a shell.

import { encodeFrame, FrameDecoder, framingErrorMessage } from "./lsp-framing";
import { dirname, join } from "node:path";
import { existsSync, statSync } from "node:fs";

export interface LspExit {
  code: number | null;
  stderrTail: string;
  reason?: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type IncomingMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

const STDERR_TAIL_LINES = 8;
const STDERR_LINE_CAP = 512;

function isResponse(m: IncomingMessage): m is JsonRpcResponse {
  return "id" in m && ("result" in m || "error" in m);
}

function isRequest(m: IncomingMessage): m is JsonRpcRequest {
  return "id" in m && "method" in m && !("result" in m) && !("error" in m);
}

export interface LspSessionCallbacks {
  onNotification: (method: string, params: unknown) => void;
  onExit: (exit: LspExit) => void;
  // Server-to-client requests the caller does not handle explicitly.
  // Defaults to a null result for the two progress/capability requests
  // Terax's transport.ts answers, method-not-found otherwise.
  onServerRequest?: (method: string, params: unknown) => unknown;
}

export interface LspSpawnOptions {
  binary: string;
  args?: string[];
  root: string;
  extraEnv?: Record<string, string>;
  callbacks: LspSessionCallbacks;
}

export class LspSession {
  private proc: ReturnType<typeof Bun.spawn>;
  private decoder = new FrameDecoder();
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private callbacks: LspSessionCallbacks;
  private stderrTail: string[] = [];
  private killed = false;
  readonly exited: Promise<LspExit>;

  private constructor(
    proc: ReturnType<typeof Bun.spawn>,
    callbacks: LspSessionCallbacks,
  ) {
    this.proc = proc;
    this.callbacks = callbacks;
    this.exited = proc.exited.then((code) => {
      for (const [, p] of this.pending) {
        p.reject(new Error("lsp server exited before responding"));
      }
      this.pending.clear();
      const exit: LspExit = {
        code,
        stderrTail: this.stderrTail.join("\n"),
      };
      if (this.killed) exit.reason = "killed by host";
      callbacks.onExit(exit);
      return exit;
    });
    this.pumpStdout();
    this.pumpStderr();
  }

  static spawn(opts: LspSpawnOptions): LspSession {
    const proc = Bun.spawn([opts.binary, ...(opts.args ?? [])], {
      cwd: opts.root,
      env: { ...process.env, ...(opts.extraEnv ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return new LspSession(proc, opts.callbacks);
  }

  get pid(): number {
    return this.proc.pid;
  }

  send(payload: string): void {
    const sink = this.proc.stdin;
    if (!sink || typeof sink === "number") {
      throw new Error("lsp session stdin closed");
    }
    const n = sink.write(encodeFrame(payload));
    if (typeof n === "number" && n < 0) {
      throw new Error("lsp write failed");
    }
    sink.flush();
  }

  notify(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method };
    if (params !== undefined) msg.params = params;
    this.send(JSON.stringify(msg));
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`lsp request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send(JSON.stringify(msg));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  kill(): void {
    this.killed = true;
    try {
      const sink = this.proc.stdin;
      if (sink && typeof sink !== "number") sink.end();
    } catch {
      // already gone
    }
    this.proc.kill();
  }

  private pumpStdout(): void {
    (async () => {
      try {
        const stdout = this.proc.stdout;
        if (!stdout || typeof stdout === "number") return;
        const reader = (stdout as ReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { messages, error } = this.decoder.push(value);
          if (error) {
            this.callbacks.onExit({
              code: null,
              stderrTail: this.stderrTail.join("\n"),
              reason: `framing error: ${framingErrorMessage(error)}; server killed`,
            });
            this.kill();
            return;
          }
          for (const payload of messages) this.dispatch(payload);
        }
      } catch {
        // stdout closed; exited promise reports the outcome
      }
    })();
  }

  private pumpStderr(): void {
    (async () => {
      try {
        const stderr = this.proc.stderr;
        if (!stderr || typeof stderr === "number") return;
        const reader = (stderr as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let line = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ch of decoder.decode(value, { stream: true })) {
            if (ch === "\n") {
              this.pushStderrLine(line);
              line = "";
            } else if (line.length < STDERR_LINE_CAP) {
              line += ch;
            }
          }
        }
        const rest = decoder.decode();
        if (rest) line += rest;
        if (line) this.pushStderrLine(line);
      } catch {
        // stderr closed
      }
    })();
  }

  private pushStderrLine(line: string): void {
    if (!line) return;
    if (this.stderrTail.length >= STDERR_TAIL_LINES) this.stderrTail.shift();
    this.stderrTail.push(line);
  }

  private dispatch(payload: string): void {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(payload) as IncomingMessage;
    } catch {
      return;
    }
    if (isResponse(msg)) {
      if (msg.id === null) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(
          new Error(`lsp error ${msg.error.code}: ${msg.error.message}`),
        );
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (isRequest(msg)) {
      const custom = this.callbacks.onServerRequest;
      let result: unknown = null;
      let error: { code: number; message: string } | undefined;
      if (custom) {
        try {
          result = custom(msg.method, msg.params);
        } catch (e) {
          error = { code: -32603, message: String(e) };
        }
      } else if (
        msg.method !== "window/workDoneProgress/create" &&
        msg.method !== "client/registerCapability"
      ) {
        error = { code: -32601, message: `method not found: ${msg.method}` };
      }
      const response: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id };
      if (error) response.error = error;
      else response.result = result ?? null;
      this.send(JSON.stringify(response));
      return;
    }
    this.callbacks.onNotification(msg.method, msg.params);
  }
}

// Port of lsp_resolve_root: walks up from path looking for a marker file,
// but never to or above $HOME (a stray ~/package.json must not make a
// server index the entire home directory).
export function resolveRoot(
  startPath: string,
  markers: string[],
): string | null {
  const home = process.env.HOME;
  let dir: string;
  try {
    dir = statSync(startPath).isDirectory() ? startPath : dirname(startPath);
  } catch {
    dir = dirname(startPath);
  }
  for (;;) {
    if (home && dir === home) return null;
    if (markers.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
