/**
 * Tiny pub/sub so git actions fired outside the panel (command palette,
 * shortcuts) can ask a mounted GitPane to refresh.
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function onGitChanged(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function emitGitChanged(): void {
  for (const l of listeners) l()
}
