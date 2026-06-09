import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cache-Control plugin for the production preview server.
//
// The problem: `vite preview` serves static files with no Cache-Control
// headers by default, so browsers fall back to heuristic caching (often
// holding index.html for hours). When we deploy a new bundle, the browser
// keeps serving the OLD index.html, which still points to the OLD hashed
// JS file. Users only see fresh code after a hard refresh or after their
// heuristic cache expires. For a no-code customer (or a coordinator like
// Ryan), that's a stale-software experience after every deploy.
//
// The fix:
//   • index.html / "/" / anything not under /assets/ → no-cache
//     (browser must revalidate every time → always picks up new bundle hash)
//   • /assets/* → public, max-age=31536000, immutable
//     (these are content-hashed by Vite, never change, can cache forever)
//
// With this in place, deploys "just work" — users see new code on next
// page load, no refresh dance required.
const cacheHeadersPlugin = () => ({
  name: 'cache-headers',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url || ''
      if (url.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
      next()
    })
  },
})

export default defineConfig({
  plugins: [react(), cacheHeadersPlugin()],
  server: {
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT) || 4173,
    allowedHosts: 'all',
  },
})
