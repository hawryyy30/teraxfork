/**
 * useLsp — React binding for the migration's shared LspManager (M3).
 *
 * One module-level manager owns server processes across the app's lifetime
 * (mirrors Terax's sessionManager). The shell acquires a read-only analysis
 * doc for the last file opened via the explorer, so the Problems panel shows
 * real publishDiagnostics without an editor; the full interactive wiring
 * (didChange on keystroke, completion, hover) lands with the M2 editor pane.
 */
import { useEffect, useState } from 'react'
import {
  LspManager,
  type LspDiagnostic,
  type LspDocHandle,
  type LspServerState,
} from './lsp-manager'

export type { LspDiagnostic, LspServerState }
export { LspManager }

let shared: LspManager | null = null

/** The one manager for the app; servers survive pane switches. */
export function getLspManager(): LspManager {
  if (!shared) shared = new LspManager()
  return shared
}

// The doc currently under read-only analysis (set by analyzePath).
let analysisHandle: LspDocHandle | null = null
let analysisPath: string | null = null

/**
 * Acquire an LSP doc for analysis of `path` (full text sync once, no editor
 * churn). Releases the previously analyzed doc. Never throws: on any failure
 * the analysis simply stays empty and the server state reads "off".
 */
export async function analyzePath(path: string, text: string): Promise<void> {
  const m = getLspManager()
  if (analysisHandle) {
    analysisHandle.release()
    analysisHandle = null
  }
  analysisPath = path
  analysisHandle = await m.acquireDoc(path, text).catch(() => null)
}

export function getAnalyzedPath(): string | null {
  return analysisPath
}

/** Diagnostics + server state for `path`, refreshed on manager emits. */
export function useLspForPath(path: string | null): {
  diags: LspDiagnostic[]
  state: LspServerState
} {
  const [diags, setDiags] = useState<LspDiagnostic[]>([])
  const [state, setState] = useState<LspServerState>('off')
  useEffect(() => {
    const m = getLspManager()
    const refresh = () => {
      if (!path) {
        setDiags([])
        setState('off')
        return
      }
      setDiags(m.getDiagnostics(path))
      setState(m.sessionStateForPath(path))
    }
    refresh()
    return m.subscribe(refresh)
  }, [path])
  return { diags, state }
}
