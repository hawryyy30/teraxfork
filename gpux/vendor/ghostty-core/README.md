# Vendored ghostty-core (spike only)

Copied from `~/workspace/terax-ai/packages/ghostty-core` on 2026-10-19 so the
spike is self-contained and portable (no absolute paths into the Terax clone).

- Upstream Ghostty commit: `ad97d331459a0762f7aea5f56fe86748e03b860f`
- Restty commit: `7700b14a7643ba9240818209ef1e0aa90d83ad77`
- Files: `adapted/TeraxGhostty.ts`, `adapted/types.ts`, `adapted/gpuCells.ts`,
  `adapted/gpuGlyphs.ts`, `adapted/viewCache.ts`, `types.ts`,
  `adapted/ghostty-vt.wasm` (SIMD), `adapted/ghostty-vt-scalar.wasm`
- Licenses: see Terax repo (`packages/ghostty-core/adapted/LICENSE.ghostty`,
  `LICENSE.restty`); Terax itself is Apache-2.0.

Do not edit these copies — re-vendor from the Terax clone when updating.
