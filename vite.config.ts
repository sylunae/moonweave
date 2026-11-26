import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

function webServiceWorker(): Plugin {
  return {
    name: 'moonweave-service-worker',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const worker = readFileSync(resolve(__dirname, 'scripts/pwa-service-worker.js'), 'utf8')
        const revision = createHash('sha256').update(worker)
        const shell = Object.values(bundle).filter((entry) => /\.(?:html|js|css)$/.test(entry.fileName))
        for (const entry of shell) {
          revision.update(entry.fileName).update(entry.type === 'chunk' ? entry.code : entry.source)
        }
        const publicDir = resolve(__dirname, 'public')
        const soundPaths = readdirSync(resolve(publicDir, 'assets/sfx')).filter((name) => name.endsWith('.wav'))
        const staticPaths = [
          'site.webmanifest', 'moonweave-logo-v2.png', 'icons/moonweave-192.png', 'icons/moonweave-512.png',
          ...soundPaths.map((name) => `assets/sfx/${name}`),
        ]
        for (const path of staticPaths) revision.update(path).update(readFileSync(resolve(publicDir, path)))
        const paths = [...shell.map((entry) => entry.fileName), ...staticPaths]
        this.emitFile({
          type: 'asset',
          fileName: 'service-worker.js',
          source: `const BUILD_ID = ${JSON.stringify(revision.digest('hex').slice(0, 16))}\nconst APP_FILES = ${JSON.stringify(paths)}\n${worker}`,
        })
      },
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), webServiceWorker()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: { outDir: 'dist', sourcemap: true },
})
