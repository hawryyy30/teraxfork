// LSP base-protocol framing codec, ported from
// ~/workspace/terax-ai/src-tauri/src/modules/lsp/framing.rs
// (Terax's Rust lsp_* dumb pipe). Pure logic, no Bun APIs, so it is
// unit-testable and reusable by the real Bun LSP host later.
// Works on raw bytes end to end, like the Rust original.

export const MAX_CONTENT_LEN = 64 * 1024 * 1024;

const TERMINATOR = [13, 10, 13, 10]; // \r\n\r\n

export type FramingError =
  | { kind: "missing-content-length" }
  | { kind: "invalid-content-length"; value: string }
  | { kind: "content-too-large"; length: number }
  | { kind: "invalid-utf8" };

export function framingErrorMessage(e: FramingError): string {
  switch (e.kind) {
    case "missing-content-length":
      return "lsp frame missing Content-Length header";
    case "invalid-content-length":
      return `lsp frame invalid Content-Length: ${e.value}`;
    case "content-too-large":
      return `lsp frame Content-Length ${e.length} exceeds cap ${MAX_CONTENT_LEN}`;
    case "invalid-utf8":
      return "lsp frame payload is not valid UTF-8";
  }
}

function findTerminator(buf: Uint8Array, from: number): number {
  outer: for (let i = from; i + TERMINATOR.length <= buf.length; i++) {
    for (let k = 0; k < TERMINATOR.length; k++) {
      if (buf[i + k] !== TERMINATOR[k]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseContentLength(headerBytes: Uint8Array): number | FramingError {
  // Headers are ASCII; a lossy decode cannot misparse them.
  const headers = new TextDecoder("ascii").decode(headerBytes);
  for (const line of headers.split("\n")) {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    if (trimmed.slice(0, colon).trim().toLowerCase() !== "content-length")
      continue;
    const value = trimmed.slice(colon + 1).trim();
    if (!/^\d+$/.test(value)) return { kind: "invalid-content-length", value };
    return Number(value);
  }
  return { kind: "missing-content-length" };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export class FrameDecoder {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private scanFrom = 0;
  private bodyLen: number | null = null;
  private poisoned: FramingError | null = null;

  // Pushes chunk bytes, returns complete payload strings. After an error the
  // decoder is poisoned and keeps erroring (mirrors the Rust struct, which
  // the session discards along with the server).
  push(bytes: Uint8Array): { messages: string[]; error?: FramingError } {
    if (this.poisoned) return { messages: [], error: this.poisoned };
    if (bytes.length > 0) {
      this.chunks.push(bytes);
      this.buffered += bytes.length;
    }
    const messages: string[] = [];

    for (;;) {
      if (this.bodyLen === null) {
        const buf = concat(this.chunks);
        const term = findTerminator(buf, this.scanFrom);
        if (term < 0) {
          // Terminator may straddle this chunk and the next.
          this.scanFrom = Math.max(0, buf.length - (TERMINATOR.length - 1));
          this.chunks = buf.length ? [buf] : [];
          return { messages };
        }
        const parsed = parseContentLength(buf.slice(0, term));
        if (typeof parsed !== "number") {
          this.poisoned = parsed;
          return { messages, error: parsed };
        }
        if (parsed > MAX_CONTENT_LEN) {
          const err: FramingError = { kind: "content-too-large", length: parsed };
          this.poisoned = err;
          return { messages, error: err };
        }
        const rest = buf.slice(term + TERMINATOR.length);
        this.chunks = rest.length ? [rest] : [];
        this.buffered = rest.length;
        this.scanFrom = 0;
        this.bodyLen = parsed;
        continue;
      }

      if (this.buffered < this.bodyLen) return { messages };
      const buf = concat(this.chunks);
      const payload = buf.slice(0, this.bodyLen);
      const rest = buf.slice(this.bodyLen);
      this.chunks = rest.length ? [rest] : [];
      this.buffered = rest.length;
      this.scanFrom = 0;
      this.bodyLen = null;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
      } catch {
        const err: FramingError = { kind: "invalid-utf8" };
        this.poisoned = err;
        return { messages, error: err };
      }
      messages.push(text);
    }
  }
}

export function encodeFrame(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const header = new TextEncoder().encode(
    `Content-Length: ${body.length}\r\n\r\n`,
  );
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}
