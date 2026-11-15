import { useCallback, useEffect, useRef, useState } from 'react'
import { petReducer } from './petState'
import type { PetAction } from './petState'
import { loadPet, ProgressValidationError, readPet, STORAGE_KEY, transactPet } from './storage'

export function useProgress() {
  const [loaded] = useState(loadPet)
  const [pet, setPet] = useState(loaded.pet)
  const current = useRef(loaded.pet)
  const offline = useRef(Boolean(loaded.notice) || !navigator.locks)
  const [canPersist, setCanPersist] = useState(() => !loaded.notice && Boolean(navigator.locks))
  const [storageNotice, setStorageNotice] = useState(() => loaded.notice || (!navigator.locks
    ? 'This browser cannot safely share progress between tabs. Changes are session-only and the timer is unavailable.' : ''))
  const [pending, setPending] = useState(0)
  const [rewardNotice, setRewardNotice] = useState<{ id: number; xp: number; credits: number } | null>(null)
  const rewardSequence = useRef(0)

  const dispatch = useCallback(async (action: PetAction): Promise<boolean> => {
    const durableAction = action.type.startsWith('timer-') || action.type.startsWith('sync-') || action.type.startsWith('care-') || action.type === 'feed'
    setPending((count) => count + 1)
    try {
      if (offline.current) throw new Error('Session-only mode')
      const result = await transactPet(action)
      current.current = result.pet
      setPet(result.pet)
      if (result.xpAwarded > 0) setRewardNotice({ id: ++rewardSequence.current, xp: result.xpAwarded, credits: result.creditsAwarded })
      return result.changed
    } catch (error) {
      if (error instanceof ProgressValidationError) return false
      // Stay session-only after a failed write; do not later overwrite saved
      // progress with a mixture of unsaved local and other-tab changes.
      offline.current = true
      setCanPersist(false)
      setStorageNotice((previous) => previous || 'Progress cannot be saved. Changes are session-only; the timer is unavailable. Existing saved progress is preserved.')
      if (durableAction) return false
      const next = petReducer(current.current, action)
      const changed = next !== current.current
      current.current = next
      setPet(next)
      return changed
    } finally {
      setPending((count) => count - 1)
    }
  }, [])

  const commitSync = useCallback(async (action: PetAction) => {
    if (!action.type.startsWith('sync-')) throw new ProgressValidationError('Expected a synchronization update.')
    if (offline.current) throw new Error('Synchronization requires available persistent storage. Reload when storage is available.')
    setPending((count) => count + 1)
    try {
      const result = await transactPet(action)
      current.current = result.pet
      setPet(result.pet)
      if (result.xpAwarded > 0) setRewardNotice({ id: ++rewardSequence.current, xp: result.xpAwarded, credits: result.creditsAwarded })
      return result
    } catch (error) {
      if (!(error instanceof ProgressValidationError)) {
        offline.current = true
        setCanPersist(false)
        setStorageNotice('Synchronization could not be saved. Existing progress is preserved. Reload when storage is available; no in-memory sync rewards were applied.')
      }
      throw error
    } finally { setPending((count) => count - 1) }
  }, [])

  useEffect(() => {
    if (!rewardNotice) return
    const timeout = window.setTimeout(() => setRewardNotice(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [rewardNotice])

  const restId = pet.care.rest?.id
  const timerId = pet.timer?.id
  const runningSince = pet.timer?.runningSince
  useEffect(() => {
    if (!pet.adopted || !canPersist) return
    let inFlight = false
    let disposed = false
    async function settleCare() {
      if (inFlight || disposed || document.hidden) return
      inFlight = true
      try { await dispatch({ type: 'care-tick', now: Date.now() }) }
      finally { inFlight = false }
    }
    // Commit a pending structural care migration under the same lock, even if
    // no stat block is due yet. Rendering and read-only loading never write.
    void settleCare()
    const needsClock = restId || (runningSince !== undefined && runningSince !== null)
    const interval = needsClock ? window.setInterval(() => void settleCare(), 15_000) : undefined
    window.addEventListener('focus', settleCare)
    document.addEventListener('visibilitychange', settleCare)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', settleCare)
      document.removeEventListener('visibilitychange', settleCare)
    }
  }, [dispatch, pet.adopted, canPersist, restId, timerId, runningSince])

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

  return { pet, dispatch, commitSync, storageNotice, canPersist, rewardNotice, busy: pending > 0 }
}
