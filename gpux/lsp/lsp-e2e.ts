// M3 headless verification: the real LspManager (default Bun spawn) against
// a real typescript-language-server, end to end. Covers acquireDoc,
// publishDiagnostics, didChange/didSave, completion, and hover — the full
// protocol surface the migration's editor UI (M2) will consume.
// Run: bun lsp/lsp-e2e.ts   (needs typescript-language-server devDependency)

import { LspManager } from "./lsp-manager";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const BROKEN_TS = `export function add(a: number, b: number): number {
  return a + b;
}
const greeting: string = add(1, 2);
export const missing = doesNotExist;
`;

const ASSIST_TS = `const greeting: string = "hello";
greeting.
export const answer: number = 42;
`;

let failed = false;
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  failed = true;
};

const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

const wsDir = mkdtempSync(join(tmpdir(), "gpux-lsp-e2e-"));
writeFileSync(
  join(wsDir, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }),
);
const brokenFile = join(wsDir, "broken.ts");
writeFileSync(brokenFile, BROKEN_TS);
const assistFile = join(wsDir, "assist.ts");
writeFileSync(assistFile, ASSIST_TS);

const manager = new LspManager();
let diags: ReturnType<LspManager["getDiagnostics"]> = [];
manager.subscribe(() => {
  diags = manager.getDiagnostics(brokenFile);
});

try {
  // --- diagnostics -------------------------------------------------------
  const handle = await manager.acquireDoc(brokenFile, BROKEN_TS);
  if (!handle) fail("acquireDoc returned null");
  else {
    console.log(`[${ms()}] acquireDoc ok, state=${manager.sessionStateForPath(brokenFile)}`);
    const deadline = Date.now() + 30_000;
    while (diags.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[${ms()}] diagnostics: ${diags.length}`);
    for (const d of diags) {
      console.log(
        `  [${d.range.start.line}:${d.range.start.character}] sev=${d.severity} ${d.message.split("\n")[0]}`,
      );
    }
    if (!diags.some((d) => d.message.includes("not assignable to type")))
      fail("missing the assignability diagnostic");
    if (!diags.some((d) => d.message.includes("doesNotExist")))
      fail("missing the cannot-find-name diagnostic");

    // didChange with the error fixed: the stale diagnostic must clear.
    const fixed = BROKEN_TS.replace("export const missing = doesNotExist;\n", "");
    manager.didChange(handle.uri, fixed);
    await new Promise((r) => setTimeout(r, 4000));
    const after = manager.getDiagnostics(brokenFile);
    console.log(`[${ms()}] after didChange(fix): ${after.length} diagnostic(s)`);
    if (after.some((d) => d.message.includes("doesNotExist")))
      fail("stale cannot-find-name diagnostic after fix");

    manager.didSave(brokenFile);
    handle.release();
  }

  // --- completion + hover ------------------------------------------------
  const assist = await manager.acquireDoc(assistFile, ASSIST_TS);
  if (!assist) fail("acquireDoc(assist) returned null");
  else {
    const items = await manager.completion(assistFile, 1, 9);
    if (!items || items.length === 0) {
      fail("completion returned no items");
    } else {
      const labels = items.map((i) => i.label);
      console.log(`[${ms()}] completion ok: ${items.length} items`);
      for (const want of ["charAt", "length"]) {
        if (!labels.includes(want)) fail(`completion missing "${want}"`);
      }
      console.log(`  sample: ${labels.slice(0, 5).join(", ")}`);
    }

    const hover = await manager.hover(assistFile, 0, 8);
    if (!hover || hover.length === 0) {
      fail("hover returned empty");
    } else {
      console.log(
        `[${ms()}] hover ok (${hover.length} chars): ${hover.slice(0, 80).replace(/\n/g, " | ")}`,
      );
    }
    assist.release();
  }
} finally {
  await manager.closeAll();
  rmSync(wsDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log(`[${ms()}] PASS: gpux LSP manager drives a real server end to end`);
