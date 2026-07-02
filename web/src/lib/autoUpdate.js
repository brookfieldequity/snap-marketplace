// Auto-update — reload the tab when a newer deployed bundle is detected, so
// users (and coordinators/providers) never have to hard-refresh after a deploy.
//
// How it works: the running tab knows which hashed entry bundle it loaded
// (from its own <script> tag). Periodically — and whenever the tab regains
// focus — it re-fetches index.html (bypassing cache) and reads the bundle hash
// the server now references. If that hash changed, a new version shipped, and
// we reload to pick it up.
//
// Production only (dev uses Vite HMR). Guards prevent reloading over unsaved
// work: window.__snapDirty (set by pages with pending edits), an actively
// focused text field, or contenteditable.

export function startAutoUpdate() {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return

  const running = currentBundle()
  if (!running) return
  let reloading = false

  async function check() {
    if (reloading) return
    let html
    try {
      const res = await fetch('/?_=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) return
      html = await res.text()
    } catch {
      return // offline / transient — try again next tick
    }
    const latest = extractBundle(html)
    if (latest && latest !== running) tryReload()
  }

  function tryReload() {
    if (window.__snapDirty) return // page has unsaved changes — don't clobber it
    const el = document.activeElement
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
    reloading = true
    window.location.reload()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('focus', check)
  // Poll while the tab is open and visible (deploys are infrequent, so this is cheap).
  setInterval(() => { if (document.visibilityState === 'visible') check() }, 3 * 60 * 1000)
  // One check shortly after load, to catch a deploy that landed while this tab was open.
  setTimeout(check, 20 * 1000)

  // Exposed for manual triggering / debugging.
  window.__snapCheckUpdate = check
}

function currentBundle() {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]')
  if (!s) return null
  try {
    return new URL(s.src, window.location.href).pathname
  } catch {
    return null
  }
}

function extractBundle(html) {
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}
