import { useCallback, useEffect, useRef, useState } from 'react'
import { petReducer } from './petState'
import type { PetAction } from './petState'
import { loadPet, readPet, STORAGE_KEY, transactPet } from './storage'

export function useProgress() {
  const [loaded] = useState(loadPet)
  const [pet, setPet] = useState(loaded.pet)
  const current = useRef(loaded.pet)
  const offline = useRef(Boolean(loaded.notice) || !navigator.locks)
  const [canPersist, setCanPersist] = useState(() => !loaded.notice && Boolean(navigator.locks))
  const [storageNotice, setStorageNotice] = useState(() => loaded.notice || (!navigator.locks
    ? 'This browser cannot safely share progress between tabs. Changes are session-only and the timer is unavailable.' : ''))
  const [pending, setPending] = useState(0)

  const dispatch = useCallback(async (action: PetAction): Promise<boolean> => {
    const timerAction = action.type.startsWith('timer-')
    setPending((count) => count + 1)
    try {
      if (offline.current) throw new Error('Session-only mode')
      const result = await transactPet(action)
      current.current = result.pet
      setPet(result.pet)
      return result.changed
    } catch {
      // Stay session-only after a failed write; do not later overwrite saved
      // progress with a mixture of unsaved local and other-tab changes.
      offline.current = true
      setCanPersist(false)
      setStorageNotice((previous) => previous || 'Progress cannot be saved. Changes are session-only; the timer is unavailable. Existing saved progress is preserved.')
      if (timerAction) return false
      const next = petReducer(current.current, action)
      const changed = next !== current.current
      current.current = next
      setPet(next)
      return changed
    } finally {
      setPending((count) => count - 1)
    }
  }, [])

  useEffect(() => {
    function refresh() {
      if (offline.current) return
      try {
        const next = readPet()
        current.current = next
        setPet(next)
      } catch {
        offline.current = true
        setCanPersist(false)
        setStorageNotice('Saved progress is unavailable. Existing data is preserved; changes are session-only and the timer is unavailable.')
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY || event.key === null) refresh()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return { pet, dispatch, storageNotice, canPersist, busy: pending > 0 }
}
