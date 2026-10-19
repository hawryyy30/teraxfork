// Unit tests for lsp-framing.ts, mirroring the test suite in
// ~/workspace/terax-ai/src-tauri/src/modules/lsp/framing.rs.

import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  FrameDecoder,
  framingErrorMessage,
  MAX_CONTENT_LEN,
  type FramingError,
} from "./lsp-framing";

const te = new TextEncoder();
const td = new TextDecoder();

function frame(payload: string): Uint8Array {
  return encodeFrame(payload);
}

function pushAll(d: FrameDecoder, bytes: Uint8Array): string[] {
  const { messages, error } = d.push(bytes);
  expect(error).toBeUndefined();
  return messages;
}

describe("encodeFrame", () => {
  it("emits exact wire bytes", () => {
    const payload = `{"jsonrpc":"2.0"}`;
    const raw = frame(payload);
    expect(td.decode(raw)).toBe(
      `Content-Length: ${te.encode(payload).length}\r\n\r\n${payload}`,
    );
  });

  it("length is in bytes, not chars", () => {
    const payload = `{"msg":"\u4e16\u754c"}`;
    const header = td.decode(frame(payload)).split("\r\n")[0];
    expect(header).toBe(`Content-Length: ${te.encode(payload).length}`);
  });
});

describe("FrameDecoder", () => {
  it("single message roundtrip", () => {
    const d = new FrameDecoder();
    expect(pushAll(d, frame(`{"jsonrpc":"2.0"}`))).toEqual([
      `{"jsonrpc":"2.0"}`,
    ]);
  });

  it("multiple messages in one chunk", () => {
    const d = new FrameDecoder();
    const a = frame(`{"a":1}`);
    const b = frame(`{"b":2}`);
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);
    expect(pushAll(d, both)).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("message split byte by byte", () => {
    const d = new FrameDecoder();
    const bytes = frame(`{"jsonrpc":"2.0","id":1}`);
    const got: string[] = [];
    for (const b of bytes) got.push(...pushAll(d, new Uint8Array([b])));
    expect(got).toEqual([`{"jsonrpc":"2.0","id":1}`]);
  });

  it("terminator straddles chunks", () => {
    const d = new FrameDecoder();
    const bytes = frame(`{"x":1}`);
    const idx = td.decode(bytes).indexOf("\r\n\r\n");
    const split = idx + 2;
    expect(pushAll(d, bytes.slice(0, split))).toEqual([]);
    expect(pushAll(d, bytes.slice(split))).toEqual([`{"x":1}`]);
  });

  it("extra headers are tolerated", () => {
    const d = new FrameDecoder();
    const payload = `{"ok":true}`;
    const raw = te.encode(
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${payload.length}\r\n\r\n${payload}`,
    );
    expect(pushAll(d, raw)).toEqual([payload]);
  });

  it("header name is case insensitive", () => {
    const d = new FrameDecoder();
    const payload = `{}`;
    const raw = te.encode(`content-length: ${payload.length}\r\n\r\n${payload}`);
    expect(pushAll(d, raw)).toEqual([payload]);
  });

  it("utf8 payload with multibyte chars", () => {
    const d = new FrameDecoder();
    const payload = `{"msg":"\u043f\u0440\u0438\u0432\u0435\u0442 \u4e16\u754c"}`;
    expect(pushAll(d, frame(payload))).toEqual([payload]);
  });

  it("multibyte char split across chunks", () => {
    const d = new FrameDecoder();
    const payload = `{"msg":"\u4e16\u754c"}`;
    const bytes = frame(payload);
    const got: string[] = [];
    // Feed in 3-byte pieces to force splits inside multibyte sequences.
    for (let i = 0; i < bytes.length; i += 3) {
      got.push(...pushAll(d, bytes.slice(i, i + 3)));
    }
    expect(got).toEqual([payload]);
  });

  it("missing content length errors", () => {
    const d = new FrameDecoder();
    const { error } = d.push(te.encode("Content-Type: text/json\r\n\r\n{}"));
    expect(error).toEqual<FramingError>({ kind: "missing-content-length" });
    expect(framingErrorMessage(error!)).toBe(
      "lsp frame missing Content-Length header",
    );
  });

  it("oversized content length errors", () => {
    const d = new FrameDecoder();
    const { error } = d.push(
      te.encode(`Content-Length: ${MAX_CONTENT_LEN + 1}\r\n\r\n`),
    );
    expect(error).toEqual<FramingError>({
      kind: "content-too-large",
      length: MAX_CONTENT_LEN + 1,
    });
  });

  it("invalid content length errors", () => {
    const d = new FrameDecoder();
    const { error } = d.push(te.encode("Content-Length: abc\r\n\r\n"));
    expect(error).toEqual<FramingError>({
      kind: "invalid-content-length",
      value: "abc",
    });
  });

  it("invalid utf8 payload errors", () => {
    const d = new FrameDecoder();
    const raw = new Uint8Array([
      ...te.encode("Content-Length: 2\r\n\r\n"),
      0xff, 0xfe,
    ]);
    const { error } = d.push(raw);
    expect(error).toEqual<FramingError>({ kind: "invalid-utf8" });
  });

  it("interleaved partial body then next frame", () => {
    const d = new FrameDecoder();
    const f1 = frame(`{"first":1}`);
    const f2 = frame(`{"second":2}`);
    const cut = f1.length - 3;
    expect(pushAll(d, f1.slice(0, cut))).toEqual([]);
    const rest = new Uint8Array(f1.length - cut + f2.length);
    rest.set(f1.slice(cut), 0);
    rest.set(f2, f1.length - cut);
    expect(pushAll(d, rest)).toEqual([`{"first":1}`, `{"second":2}`]);
  });

  it("lf-only headers do not terminate a frame", () => {
    const d = new FrameDecoder();
    const raw = te.encode('Content-Length: 2\n\n{"a":1}');
    expect(pushAll(d, raw)).toEqual([]);
  });

  it("short body waits silently for the announced length", () => {
    const d = new FrameDecoder();
    const full = frame(`{"abc":1}`);
    const cut = full.length - 3;
    expect(pushAll(d, full.slice(0, cut))).toEqual([]);
    expect(pushAll(d, full.slice(cut))).toEqual([`{"abc":1}`]);
  });

  it("decoder stays erroring after a malformed header block", () => {
    const d = new FrameDecoder();
    const bad = te.encode("Content-Length: notanumber\r\n\r\n{}");
    const { error: e1 } = d.push(bad);
    expect(e1).toEqual<FramingError>({
      kind: "invalid-content-length",
      value: "notanumber",
    });
    const { error: e2 } = d.push(bad);
    expect(e2).toEqual<FramingError>({
      kind: "invalid-content-length",
      value: "notanumber",
    });
  });
});
