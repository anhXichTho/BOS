import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Reads user preferences from AuthContext and applies them to the document
 * root via data attributes. Pure side-effect component mounted inside AuthProvider.
 *
 *   data-font="inter" (default) | "plex" | "serif"  → swaps body font (CSS overrides --font-serif)
 *   data-theme="carbon"                              → XT v1.1 light theme (sole; kept for forward-compat)
 *
 * Legacy preference values are coerced silently:
 *   font: unknown value → 'inter'   theme: 'warm'/'dark' → 'carbon'
 */
export default function ThemeApplier() {
  const { preferences } = useAuth()

  const rawFont = (preferences.font as string | undefined) ?? 'inter'
  const font: 'inter' | 'plex' | 'serif' =
    rawFont === 'plex'  ? 'plex'  :
    rawFont === 'serif' ? 'serif' :
    'inter'

  const theme = 'carbon'

  useEffect(() => { document.documentElement.dataset.font  = font  }, [font])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  return null
}
