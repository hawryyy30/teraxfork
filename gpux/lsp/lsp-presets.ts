// Language-server presets for the gpux migration (M3).
// Ported from ~/workspace/terax-gpuix/spike/lsp-presets.ts (minimal analogue
// of Terax's src/modules/lsp/lib/presets.ts); the manager (lsp-manager.ts)
// owns policy. The binaries below are devDependencies of gpux/ and are used
// by the headless e2e (bun lsp/lsp-e2e.ts); production servers resolve via
// $PATH at runtime, so the migration ships zero LSP weight by default.

export interface LspPreset {
  id: string;
  name: string;
  /** Binary to spawn: absolute path or bare name resolved via $PATH. */
  command: string;
  args?: string[];
  /** file extension -> LSP language id (e.g. { ts: 'typescript' }) */
  languages: Record<string, string>;
  /** Root markers walked up from the file; fall back to .git. */
  rootMarkers: string[];
  extraEnv?: Record<string, string>;
}

const GPUX_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** typescript-language-server ships as a devDependency of gpux. */
export const TYPESCRIPT_PRESET: LspPreset = {
  id: "typescript",
  name: "TypeScript",
  command: `${GPUX_DIR}/node_modules/.bin/typescript-language-server`,
  args: ["--stdio"],
  languages: {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mts: "typescript",
    cts: "typescript",
  },
  rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
};

export const PRESETS: LspPreset[] = [TYPESCRIPT_PRESET];

export function presetForExtension(ext: string): LspPreset | null {
  const lower = ext.toLowerCase();
  for (const preset of PRESETS) {
    if (lower in preset.languages) return preset;
  }
  return null;
}
