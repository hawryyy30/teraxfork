// Step 2h: tests for the lsp-manager.ts policy port.
// Fake pipes (no real servers); short injected timings; real resolveRoot
// against temp dirs with marker files.

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LspManager,
  fileUri,
  resolveBinary,
  type LspPipe,
  type PipeCallbacks,
  type LspPreset,
  type LspDocHandle,
} from "./lsp-manager";

const FAKE_PRESET: LspPreset = {
  id: "fake",
  name: "Fake",
  command: "true", // exists via $PATH; spawn itself is injected
  args: [],
  languages: { fakets: "fakelang" },
  rootMarkers: ["marker.json"],
};

const TIMINGS = {
  idleShutdownMs: 60,
  crashWindowMs: 500,
  maxCrashes: 3,
  crashCooldownsMs: [30, 60, 90],
  maxSessionsPerPreset: 4,
  evictionMinAgeMs: 20,
  shutdownTimeoutMs: 50,
};

type SpawnRecord = {
  root: string;
  callbacks: PipeCallbacks;
  pipe: FakePipe;
  notifications: [string, unknown][];
  requests: [string, unknown][];
  killed: boolean;
};

class FakePipe {
  pid = 4242;
  notifications: [string, unknown][] = [];
  requests: [string, unknown][] = [];
  killed = false;
  /** Scripted responses by method, for completion/hover tests. */
  responses: Record<string, unknown> = {};
  private exitedResolve!: (v: unknown) => void;
  readonly exited: Promise<unknown>;

  constructor() {
    this.exited = new Promise<unknown>((r) => (this.exitedResolve = r));
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push([method, params]);
    if (method in this.responses) return this.responses[method];
    return method === "initialize" ? { capabilities: {} } : null;
  }

  notify(method: string, params?: unknown): void {
    this.notifications.push([method, params]);
    if (method === "exit") this.exitedResolve(null);
  }

  kill(): void {
    this.killed = true;
    this.exitedResolve(null);
  }
}

let wsDir: string;
let spawns: SpawnRecord[];
let manager: LspManager;

function makeRoot(name: string): string {
  const dir = join(wsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "marker.json"), "{}");
  return dir;
}

function makeFile(root: string, name: string): string {
  const p = join(root, name);
  writeFileSync(p, "// fake\n");
  return p;
}

function makeManager(presetOverrides?: Partial<LspPreset>): LspManager {
  spawns = [];
  const presets = presetOverrides
    ? [{ ...FAKE_PRESET, ...presetOverrides }]
    : [FAKE_PRESET];
  return new LspManager({
    presets,
    timings: TIMINGS,
    detectBinary: () => "/usr/bin/true",
    spawnPipe: async (preset, root, callbacks) => {
      const pipe = new FakePipe();
      spawns.push({ root, callbacks, pipe, notifications: pipe.notifications, requests: pipe.requests, killed: false });
      return pipe as unknown as LspPipe;
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  wsDir = mkdtempSync(join(tmpdir(), "lsp-mgr-"));
  manager = makeManager();
});

afterEach(async () => {
  await manager.closeAll();
  rmSync(wsDir, { recursive: true, force: true });
});

describe("resolveBinary", () => {
  test("resolves absolute executable paths; rejects missing ones", () => {
    expect(resolveBinary("/bin/true") ?? resolveBinary("/usr/bin/true")).toBeTruthy();
    expect(resolveBinary("/no/such/binary-xyz")).toBeNull();
  });

  test("bare-name lookup needs the Bun runtime (vitest runs under node)", () => {
    const underBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
    // Under node, Bun.which is unavailable so bare names resolve to null;
    // the manager's injectable detectBinary covers that path in tests.
    expect(underBun ? resolveBinary("true") : resolveBinary("true")).toBe(
      underBun ? expect.any(String) : null,
    );
  });
});

describe("acquireDoc", () => {
  test("spawns one session per root and reuses it for a second doc", async () => {
    const root = makeRoot("a");
    const f1 = makeFile(root, "one.fakets");
    const f2 = makeFile(root, "two.fakets");
    const h1 = await manager.acquireDoc(f1, "a");
    const h2 = await manager.acquireDoc(f2, "b");
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(spawns).toHaveLength(1);
    expect(spawns[0].root).toBe(root);
    const didOpens = spawns[0].notifications.filter(([m]) => m === "textDocument/didOpen");
    expect(didOpens).toHaveLength(2);
    expect((didOpens[0][1] as { textDocument: { version: number } }).textDocument.version).toBe(1);
    h1!.release();
    h2!.release();
  });

  test("re-acquiring an already-open doc sends a full-replace didChange", async () => {
    const root = makeRoot("a");
    const f1 = makeFile(root, "one.fakets");
    const h1 = await manager.acquireDoc(f1, "v1");
    const h2 = await manager.acquireDoc(f1, "v2");
    const didChanges = spawns[0].notifications.filter(([m]) => m === "textDocument/didChange");
    expect(didChanges).toHaveLength(1);
    expect((didChanges[0][1] as { textDocument: { version: number } }).textDocument.version).toBe(2);
    h1!.release();
    // one ref still held after first release: no didClose yet
    expect(spawns[0].notifications.some(([m]) => m === "textDocument/didClose")).toBe(false);
    h2!.release();
    expect(spawns[0].notifications.some(([m]) => m === "textDocument/didClose")).toBe(true);
  });

  test("unknown extension returns null without spawning", async () => {
    const root = makeRoot("a");
    const f = makeFile(root, "one.unknownext");
    expect(await manager.acquireDoc(f, "x")).toBeNull();
    expect(spawns).toHaveLength(0);
  });

  test("no project root returns null without spawning", async () => {
    const lonely = join(wsDir, "lonely.fakets");
    writeFileSync(lonely, "x");
    expect(await manager.acquireDoc(lonely, "x")).toBeNull();
    expect(spawns).toHaveLength(0);
  });

  test("didClose on last release, then idle shutdown closes the session", async () => {
    const root = makeRoot("a");
    const f = makeFile(root, "one.fakets");
    const h = await manager.acquireDoc(f, "x");
    h!.release();
    expect(spawns[0].notifications.some(([m]) => m === "textDocument/didClose")).toBe(true);
    expect(spawns[0].pipe.killed).toBe(false);
    await sleep(120); // past idleShutdownMs=60
    expect(spawns[0].requests.some(([m]) => m === "shutdown")).toBe(true);
    expect(spawns[0].pipe.killed).toBe(true);
  });

  test("a new acquire cancels the pending idle shutdown", async () => {
    const root = makeRoot("a");
    const f = makeFile(root, "one.fakets");
    const h1 = await manager.acquireDoc(f, "x");
    h1!.release();
    await sleep(30); // idle timer pending but not fired
    const h2 = await manager.acquireDoc(f, "x");
    expect(h2).not.toBeNull();
    await sleep(80); // past the original idle deadline
    expect(spawns[0].pipe.killed).toBe(false);
    h2!.release();
  });
});

describe("session cap and eviction", () => {
  test("cap of 4 sessions per preset: the 5th root is refused", async () => {
    const handles: LspDocHandle[] = [];
    for (let i = 0; i < 4; i++) {
      const root = makeRoot(`r${i}`);
      const h = await manager.acquireDoc(makeFile(root, "f.fakets"), "x");
      expect(h).not.toBeNull();
      handles.push(h!);
    }
    const root5 = makeRoot("r5");
    expect(await manager.acquireDoc(makeFile(root5, "f.fakets"), "x")).toBeNull();
    expect(spawns).toHaveLength(4);
    for (const h of handles) h.release();
  });

  test("creating a new root evicts an idle old-root session past min age", async () => {
    const rootA = makeRoot("a");
    const hA = await manager.acquireDoc(makeFile(rootA, "f.fakets"), "x");
    expect(hA).not.toBeNull();
    hA!.release(); // refs=0, idle timer pending
    await sleep(30); // past evictionMinAgeMs=20, before idleShutdownMs=60
    const rootB = makeRoot("b");
    const hB = await manager.acquireDoc(makeFile(rootB, "f.fakets"), "x");
    expect(hB).not.toBeNull();
    expect(spawns).toHaveLength(2);
    expect(spawns[0].pipe.killed).toBe(true); // evicted
    hB!.release();
  });
});

describe("crash policy", () => {
  // All crashes in a test share one root: crash tracking is per
  // `${preset.id}\0${root}` key, mirroring Terax.
  async function crashOnce(root: string): Promise<string> {
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    expect(h).not.toBeNull();
    h!.release();
    const rec = spawns[spawns.length - 1];
    rec.callbacks.onExit(null, "boom");
    await sleep(5);
    return f;
  }

  test("one crash: acquire blocked during cooldown, allowed after", async () => {
    const root = makeRoot("crash1");
    const f = await crashOnce(root);
    expect(manager.sessionStateForPath(f)).toBe("crashed");
    expect(await manager.acquireDoc(f, "x")).toBeNull(); // within 30ms cooldown
    await sleep(50);
    const h = await manager.acquireDoc(f, "x");
    expect(h).not.toBeNull();
    h!.release();
  });

  test("three crashes in the window: crashed-out, no more acquires", async () => {
    const root = makeRoot("crash3");
    const f = await crashOnce(root);
    await sleep(50); // cooldown 1
    await crashOnce(root);
    await sleep(80); // cooldown 2
    await crashOnce(root);
    expect(manager.sessionStateForPath(f)).toBe("crashed-out");
    expect(await manager.acquireDoc(f, "x")).toBeNull();
    expect(await manager.acquireDoc(f, "x")).toBeNull();
    expect(spawns).toHaveLength(3);
  });
});

describe("document sync and diagnostics", () => {
  test("didChange bumps versions; didSave notifies", async () => {
    const root = makeRoot("a");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "v1");
    manager.didChange(fileUri(f), "v2");
    manager.didChange(fileUri(f), "v3");
    const changes = spawns[0].notifications.filter(([m]) => m === "textDocument/didChange");
    expect(changes.map(([_, p]) => (p as { textDocument: { version: number } }).textDocument.version)).toEqual([2, 3]);
    manager.didSave(f);
    expect(spawns[0].notifications.some(([m]) => m === "textDocument/didSave")).toBe(true);
    h!.release();
  });

  test("publishDiagnostics are stored, queryable, and emitted to subscribers", async () => {
    const root = makeRoot("a");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    let emitted = 0;
    const unsub = manager.subscribe(() => emitted++);
    const uri = fileUri(f);
    spawns[0].callbacks.onNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: [{ range: { start: { line: 3, character: 4 } }, severity: 1, message: "nope" }],
    });
    const diags = manager.getDiagnostics(f);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe("nope");
    expect(diags[0].range.start.line).toBe(3);
    expect(emitted).toBeGreaterThan(0);
    // other notifications don't touch diagnostics
    spawns[0].callbacks.onNotification("something/else", {});
    expect(manager.getDiagnostics(f)).toHaveLength(1);
    unsub();
    h!.release();
  });
});

describe("completion and hover (fake pipes)", () => {
  test("completion parses a CompletionList and sends the right request", async () => {
    const root = makeRoot("c");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    spawns[0].pipe.responses["textDocument/completion"] = {
      isIncomplete: false,
      items: [
        { label: "foobar", kind: 6, detail: "const foobar: 1" },
        { label: "baz", textEdit: { newText: "baz()" }, detail: "fn" },
        { label: "", kind: 3 },
      ],
    };
    const items = await manager.completion(f, 0, 5);
    expect(items).toHaveLength(2); // the empty-label item is dropped
    expect(items![0]).toEqual({ label: "foobar", insertText: undefined, detail: "const foobar: 1", kind: 6 });
    expect(items![1].insertText).toBe("baz()");
    const [method, params] = spawns[0].requests.find(([m]) => m === "textDocument/completion")!;
    expect(method).toBe("textDocument/completion");
    expect((params as { position: { line: number; character: number } }).position).toEqual({ line: 0, character: 5 });
    h!.release();
  });

  test("completion accepts a bare array result", async () => {
    const root = makeRoot("c2");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    spawns[0].pipe.responses["textDocument/completion"] = [{ label: "solo" }];
    const items = await manager.completion(fileUri(f), 1, 2);
    expect(items).toEqual([{ label: "solo", insertText: undefined, detail: undefined, kind: undefined }]);
    h!.release();
  });

  test("completion returns null with no session or null result", async () => {
    expect(await manager.completion("/nope/x.fakets", 0, 0)).toBeNull();
    const root = makeRoot("c3");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    expect(await manager.completion(f, 0, 0)).toBeNull(); // pipe returns null
    h!.release();
  });

  test("hover flattens MarkupContent, MarkedString and arrays", async () => {
    const root = makeRoot("h");
    const f = makeFile(root, "f.fakets");
    const h = await manager.acquireDoc(f, "x");
    const pipe = spawns[0].pipe;
    pipe.responses["textDocument/hover"] = {
      contents: { kind: "markdown", value: "**foo** — the thing" },
    };
    expect(await manager.hover(f, 0, 3)).toBe("**foo** — the thing");
    pipe.responses["textDocument/hover"] = {
      contents: [
        { language: "ts", value: "const x: number" },
        "plain string part",
        { kind: "plaintext", value: "docs" },
      ],
    };
    expect(await manager.hover(f, 0, 3)).toBe("const x: number\n\nplain string part\n\ndocs");
    pipe.responses["textDocument/hover"] = { contents: [] };
    expect(await manager.hover(f, 0, 3)).toBeNull();
    pipe.responses["textDocument/hover"] = null;
    expect(await manager.hover(f, 0, 3)).toBeNull();
    h!.release();
  });

  test("hover returns null with no session", async () => {
    expect(await manager.hover("/nope/x.fakets", 0, 0)).toBeNull();
  });
});
