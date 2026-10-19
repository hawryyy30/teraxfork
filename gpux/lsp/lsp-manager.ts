// Step 2h: Bun port of Terax's session-manager policy
// (~/workspace/terax-ai/src/modules/lsp/lib/sessionManager.ts) on top of the
// lsp-session.ts dumb pipe.
//
// What this keeps from Terax, in order of importance:
// - key = `${preset.id}\0${root}`: one session per (server, project root)
// - per-document refcounts; idle sessions shut down after IDLE_SHUTDOWN_MS
// - crash tracking: 3 exits in 5 min => crashed-out (no more acquires);
//   otherwise an exponential cooldown (2s / 10s / 30s) before re-acquire
// - 4 sessions per preset cap; creating a new root evicts idle sessions of
//   other roots (with a 10 s min-age guard so simultaneous multi-root opens
//   don't evict each other's newborns)
// - no root => no session (per-directory fallback burned gigabytes in Terax)
//
// Divergences (the dumb pipe can't do these yet):
// - no RSS policing, so the "budget kill doesn't respawn" branch is absent
// - full-text didChange sync instead of Terax's incremental sync — the
//   spike's protocol surface stays small; the real port takes incremental
// - protocol intelligence (initialize handshake, didOpen/didChange/...) lives
//   here as the caller, mirroring the Rust dumb-pipe design

import { LspSession, resolveRoot } from "./lsp-session";
import { PRESETS, type LspPreset } from "./lsp-presets";

export type { LspPreset };
import { accessSync, constants } from "node:fs";

export interface LspDiagnostic {
  range: { start: { line: number; character: number } };
  severity?: number; // 1 error, 2 warning, 3 info, 4 hint
  message: string;
}

export interface LspCompletionItem {
  label: string;
  insertText?: string;
  detail?: string;
  kind?: number; // LSP CompletionItemKind
}

/** Flatten an LSP Hover.contents into display text.
    Handles string | MarkupContent | MarkedString | MarkedString[]. */
function flattenHoverContents(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents))
    return contents
      .map((c) => flattenHoverContents(c))
      .filter((s) => s.length > 0)
      .join("\n\n");
  if (contents && typeof contents === "object") {
    const c = contents as { value?: unknown };
    // MarkupContent ("markdown"/"plaintext") and MarkedString {language, value}
    if (typeof c.value === "string") return c.value;
  }
  return "";
}

/** Structural pipe the manager needs; LspSession satisfies this. */
export interface LspPipe {
  readonly pid: number;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  kill(): void;
  readonly exited: Promise<unknown>;
}

export type PipeCallbacks = {
  onNotification: (method: string, params: unknown) => void;
  onExit: (code: number | null, stderrTail: string) => void;
};

export type SpawnPipeFn = (
  preset: LspPreset,
  root: string,
  callbacks: PipeCallbacks,
) => Promise<LspPipe>;

export type LspServerState =
  | "off"
  | "starting"
  | "running"
  | "crashed"
  | "crashed-out";

export interface LspManagerTimings {
  idleShutdownMs: number;
  crashWindowMs: number;
  maxCrashes: number;
  crashCooldownsMs: number[];
  maxSessionsPerPreset: number;
  evictionMinAgeMs: number;
  shutdownTimeoutMs: number;
}

const DEFAULT_TIMINGS: LspManagerTimings = {
  idleShutdownMs: 3 * 60 * 1000,
  crashWindowMs: 5 * 60 * 1000,
  maxCrashes: 3,
  crashCooldownsMs: [2_000, 10_000, 30_000],
  maxSessionsPerPreset: 4,
  evictionMinAgeMs: 10_000,
  shutdownTimeoutMs: 2_000,
};

export interface LspManagerOptions {
  presets?: LspPreset[];
  timings?: Partial<LspManagerTimings>;
  spawnPipe?: SpawnPipeFn;
  /** Binary probe; defaults to resolveBinary (Bun.which under Bun). */
  detectBinary?: (command: string) => string | null;
  now?: () => number;
}

export interface LspDocHandle {
  readonly uri: string;
  release: () => void;
}

type Managed = {
  key: string;
  preset: LspPreset;
  root: string;
  pipe: LspPipe;
  refs: Map<string, number>;
  versions: Map<string, number>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  bornAt: number;
};

export function fileUri(path: string): string {
  return path.startsWith("file://") ? path : "file://" + path;
}

export function resolveBinary(command: string): string | null {
  if (command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  // Bun.which only exists under the Bun runtime (vitest runs under node).
  const bun = (globalThis as { Bun?: { which(cmd: string): string | null } }).Bun;
  return bun?.which(command) ?? null;
}

const INITIALIZE_CAPABILITIES = {
  textDocument: {
    // Terax's client.ts adds this manually because the underlying lib
    // forgets it; without it typescript-language-server sends no diagnostics.
    publishDiagnostics: { relatedInformation: true, versionSupport: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    completion: { completionItem: { snippetSupport: false } },
  },
};

/** Default spawn: LspSession dumb pipe + initialize handshake. */
export async function spawnBunPipe(
  preset: LspPreset,
  root: string,
  callbacks: PipeCallbacks,
): Promise<LspPipe> {
  const bin = resolveBinary(preset.command);
  if (!bin) throw new Error(`lsp binary not found: ${preset.command}`);
  let exitedEarly = false;
  const session = LspSession.spawn({
    binary: bin,
    args: preset.args,
    root,
    extraEnv: preset.extraEnv,
    callbacks: {
      onNotification: callbacks.onNotification,
      onExit: (exit) => {
        exitedEarly = true;
        callbacks.onExit(exit.code, exit.stderrTail);
      },
    },
  });
  await session.request(
    "initialize",
    {
      processId: process.pid,
      rootUri: fileUri(root),
      capabilities: INITIALIZE_CAPABILITIES,
    },
    30_000,
  );
  session.notify("initialized", {});
  // Exit can beat the acquire when the binary dies instantly (e.g. a proxy
  // for an uninstalled component); reap it here.
  if (exitedEarly) throw new Error("lsp server exited during initialize");
  return session;
}

export class LspManager {
  private presets: LspPreset[];
  private timings: LspManagerTimings;
  private spawnPipe: SpawnPipeFn;
  private now: () => number;
  private sessions = new Map<string, Managed>();
  private creating = new Map<string, Promise<Managed | null>>();
  private crashTimes = new Map<string, number[]>();
  private nextRetryAt = new Map<string, number>();
  private failedKeys = new Set<string>();
  private diagsByUri = new Map<string, LspDiagnostic[]>();
  private listeners = new Set<() => void>();
  private detectBinary: (command: string) => string | null;

  constructor(opts: LspManagerOptions = {}) {
    this.presets = opts.presets ?? PRESETS;
    this.timings = { ...DEFAULT_TIMINGS, ...(opts.timings ?? {}) };
    this.spawnPipe = opts.spawnPipe ?? spawnBunPipe;
    this.detectBinary = opts.detectBinary ?? resolveBinary;
    this.now = opts.now ?? (() => Date.now());
  }

  /** React-friendly subscription: fired on diagnostics and server state changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // a broken listener must not break the manager
      }
    }
  }

  sessionStateForPath(path: string): LspServerState {
    const key = this.keyForPath(path);
    if (!key) return "off";
    if (this.sessions.has(key)) return "running";
    if (this.failedKeys.has(key)) return "crashed-out";
    if ((this.nextRetryAt.get(key) ?? 0) > this.now()) return "crashed";
    if (this.creating.has(key)) return "starting";
    return "off";
  }

  getDiagnostics(pathOrUri: string): LspDiagnostic[] {
    const uri = fileUri(pathOrUri);
    return this.diagsByUri.get(uri) ?? [];
  }

  /** Open (or re-acquire) a document; the handle owns one refcount. */
  async acquireDoc(path: string, text: string): Promise<LspDocHandle | null> {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const preset = this.presets.find((p) => ext in p.languages) ?? null;
    if (!preset) return null;
    if (!this.detectBinary(preset.command)) return null;

    const markers = preset.rootMarkers.length > 0 ? preset.rootMarkers : [".git"];
    const root = resolveRoot(path, markers);
    if (!root) return null;

    const key = `${preset.id}\0${root}`;
    if (this.crashedOut(key)) return null;
    if ((this.nextRetryAt.get(key) ?? 0) > this.now()) return null;

    if (
      !this.sessions.has(key) &&
      [...this.sessions.values()].filter((m) => m.preset.id === preset.id)
        .length >= this.timings.maxSessionsPerPreset
    ) {
      console.warn(`[lsp] session cap reached for ${preset.id}, skipping ${root}`);
      return null;
    }

    // Evict idle sessions of other roots; the age guard keeps simultaneous
    // multi-root opens from evicting each other's newborn sessions.
    if (!this.sessions.has(key)) {
      const now = this.now();
      for (const m of this.sessions.values()) {
        if (
          m.preset.id === preset.id &&
          m.refs.size === 0 &&
          !m.closing &&
          now - m.bornAt > this.timings.evictionMinAgeMs
        ) {
          void this.closeSession(m);
        }
      }
    }

    const managed = this.sessions.get(key) ?? (await this.getOrCreate(key, preset, root));
    if (!managed) return null;

    const uri = fileUri(path);
    const languageId = preset.languages[ext] ?? ext;
    if (!managed.refs.has(uri)) {
      const version = 1;
      managed.versions.set(uri, version);
      managed.pipe.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version, text },
      });
    } else {
      // Re-acquire of an already-open doc (e.g. reopened file): full replace.
      const version = (managed.versions.get(uri) ?? 0) + 1;
      managed.versions.set(uri, version);
      managed.pipe.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    this.addRef(managed, uri);

    let released = false;
    return {
      uri,
      release: () => {
        if (released) return;
        released = true;
        this.releaseRef(managed, uri);
      },
    };
  }

  /** Full-text sync; call debounced from the editor. */
  didChange(uri: string, text: string): void {
    for (const managed of this.sessions.values()) {
      if (managed.refs.has(uri) && !managed.closing) {
        const version = (managed.versions.get(uri) ?? 0) + 1;
        managed.versions.set(uri, version);
        managed.pipe.notify("textDocument/didChange", {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
      }
    }
  }

  didSave(path: string): void {
    const uri = fileUri(path);
    for (const managed of this.sessions.values()) {
      if (managed.refs.has(uri) && !managed.closing) {
        managed.pipe.notify("textDocument/didSave", { textDocument: { uri } });
      }
    }
  }

  /** textDocument/completion against the session owning this doc.
      Returns the label-normalized items, or null when no session/doc. */
  async completion(
    pathOrUri: string,
    line: number,
    character: number,
  ): Promise<LspCompletionItem[] | null> {
    const uri = fileUri(pathOrUri);
    const managed = this.managedForUri(uri);
    if (!managed || managed.closing) return null;
    const result = (await managed.pipe
      .request(
        "textDocument/completion",
        {
          textDocument: { uri },
          position: { line, character },
        },
        10_000,
      )
      .catch(() => null)) as { items?: unknown[] } | unknown[] | null;
    if (!result) return null;
    const rawItems = Array.isArray(result) ? result : (result.items ?? []);
    return rawItems
      .map((it) => {
        const i = it as {
          label?: unknown;
          insertText?: unknown;
          textEdit?: { newText?: unknown };
          detail?: unknown;
          kind?: unknown;
        };
        return {
          label: String(i.label ?? ""),
          insertText:
            typeof i.insertText === "string"
              ? i.insertText
              : typeof i.textEdit?.newText === "string"
                ? i.textEdit.newText
                : undefined,
          detail: typeof i.detail === "string" ? i.detail : undefined,
          kind: typeof i.kind === "number" ? i.kind : undefined,
        };
      })
      .filter((i) => i.label.length > 0);
  }

  /** textDocument/hover against the session owning this doc.
      Returns the contents flattened to a single string, or null. */
  async hover(
    pathOrUri: string,
    line: number,
    character: number,
  ): Promise<string | null> {
    const uri = fileUri(pathOrUri);
    const managed = this.managedForUri(uri);
    if (!managed || managed.closing) return null;
    const result = (await managed.pipe
      .request(
        "textDocument/hover",
        {
          textDocument: { uri },
          position: { line, character },
        },
        10_000,
      )
      .catch(() => null)) as { contents?: unknown } | null;
    const text = flattenHoverContents(result?.contents);
    return text.length > 0 ? text : null;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((m) => this.closeSession(m)));
    this.creating.clear();
  }

  // -- internals ---------------------------------------------------------

  private managedForUri(uri: string): Managed | null {
    for (const managed of this.sessions.values()) {
      if (managed.refs.has(uri)) return managed;
    }
    return null;
  }

  private keyForPath(path: string): string | null {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const preset = this.presets.find((p) => ext in p.languages);
    if (!preset) return null;
    const markers = preset.rootMarkers.length > 0 ? preset.rootMarkers : [".git"];
    const root = resolveRoot(path, markers);
    if (!root) return null;
    return `${preset.id}\0${root}`;
  }

  private crashedOut(key: string): boolean {
    const now = this.now();
    const times = (this.crashTimes.get(key) ?? []).filter(
      (t) => now - t < this.timings.crashWindowMs,
    );
    this.crashTimes.set(key, times);
    return times.length >= this.timings.maxCrashes;
  }

  private recordCrash(key: string): void {
    const times = this.crashTimes.get(key) ?? [];
    times.push(this.now());
    this.crashTimes.set(key, times);
  }

  private getOrCreate(
    key: string,
    preset: LspPreset,
    root: string,
  ): Promise<Managed | null> {
    let inflight = this.creating.get(key);
    if (!inflight) {
      inflight = this.createSession(key, preset, root).finally(() =>
        this.creating.delete(key),
      );
      this.creating.set(key, inflight);
    }
    return inflight;
  }

  private async createSession(
    key: string,
    preset: LspPreset,
    root: string,
  ): Promise<Managed | null> {
    const existing = this.sessions.get(key);
    if (existing) return existing;

    let pipe: LspPipe;
    try {
      pipe = await this.spawnPipe(preset, root, {
        onNotification: (method, params) =>
          this.onSessionNotification(key, method, params),
        onExit: (code, stderrTail) => this.handleServerExit(key, code, stderrTail),
      });
    } catch (e) {
      this.recordCrash(key);
      this.scheduleRetry(key);
      console.warn(`[lsp] ${preset.name} failed to start: ${(e as Error).message}`);
      return null;
    }

    const managed: Managed = {
      key,
      preset,
      root,
      pipe,
      refs: new Map(),
      versions: new Map(),
      idleTimer: null,
      closing: false,
      bornAt: this.now(),
    };
    this.sessions.set(key, managed);
    this.emit();
    return managed;
  }

  private onSessionNotification(key: string, method: string, params: unknown): void {
    if (method === "textDocument/publishDiagnostics") {
      const p = params as { uri: string; diagnostics: LspDiagnostic[] };
      this.diagsByUri.set(p.uri, p.diagnostics ?? []);
      this.emit();
      return;
    }
    void key;
  }

  private handleServerExit(key: string, code: number | null, stderrTail: string): void {
    const managed = this.sessions.get(key);
    if (!managed || managed.closing) return;
    managed.closing = true;
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    this.recordCrash(key);
    this.sessions.delete(key);
    for (const uri of managed.refs.keys()) this.diagsByUri.delete(uri);
    if (this.crashedOut(key)) {
      this.failedKeys.add(key);
      console.warn(
        `[lsp] ${managed.preset.name} keeps crashing; giving up for this workspace${stderrTail ? `: ${stderrTail.slice(-300)}` : ""}`,
      );
    } else {
      this.scheduleRetry(key);
      console.warn(
        `[lsp] ${managed.preset.name} exited (code=${code}); retry after cooldown${stderrTail ? `: ${stderrTail.slice(-300)}` : ""}`,
      );
    }
    this.emit();
  }

  private scheduleRetry(key: string): void {
    const crashes = this.crashTimes.get(key)?.length ?? 1;
    const cooldowns = this.timings.crashCooldownsMs;
    const delay = cooldowns[Math.min(crashes - 1, cooldowns.length - 1)];
    this.nextRetryAt.set(key, this.now() + delay);
  }

  private addRef(managed: Managed, uri: string): void {
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    managed.refs.set(uri, (managed.refs.get(uri) ?? 0) + 1);
  }

  private releaseRef(managed: Managed, uri: string): void {
    const count = managed.refs.get(uri);
    if (count === undefined) return;
    if (count > 1) {
      managed.refs.set(uri, count - 1);
      return;
    }
    managed.refs.delete(uri);
    managed.versions.delete(uri);
    this.diagsByUri.delete(uri);
    if (!managed.closing) {
      managed.pipe.notify("textDocument/didClose", { textDocument: { uri } });
    }
    if (managed.refs.size === 0 && !managed.closing) {
      managed.idleTimer = setTimeout(() => {
        void this.closeSession(managed);
      }, this.timings.idleShutdownMs);
    }
  }

  private async closeSession(managed: Managed): Promise<void> {
    if (managed.closing) return;
    managed.closing = true;
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    this.sessions.delete(managed.key);
    this.emit();
    try {
      await managed.pipe.request("shutdown", undefined, this.timings.shutdownTimeoutMs);
      managed.pipe.notify("exit");
      await managed.pipe.exited;
    } catch {
      // server already gone or ignoring us; kill to be sure
    }
    managed.pipe.kill();
  }
}
