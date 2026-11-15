import { useCallback, useEffect, useState } from 'react'

/** Event feedback is temporary; persistent session notices use current state. */
export function useTransientFeedback(durationMs = 5000) {
  const [entry, setEntry] = useState<{ message: string } | null>(null)
  const show = useCallback((message: string) => setEntry(message ? { message } : null), [])
  useEffect(() => {
    if (!entry) return
    const timeout = window.setTimeout(() => setEntry((current) => current === entry ? null : current), durationMs)
    return () => window.clearTimeout(timeout)
  }, [entry, durationMs])
  return [entry?.message ?? '', show] as const
}
