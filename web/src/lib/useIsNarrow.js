import { useState, useEffect } from 'react'

// Shared "is this a phone/tablet viewport?" hook. Used to gate mobile-only
// layout (off-canvas nav drawers, stacked panels) so desktop rendering is
// completely untouched above the breakpoint.
export default function useIsNarrow(bp = 860) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < bp)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [bp])
  return narrow
}
