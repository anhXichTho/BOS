import { useEffect, useState } from 'react'

/** Listen to a CSS media query. Returns boolean indicating whether it matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** True on screens ≥ md (768px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
