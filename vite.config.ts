import { defineConfig, type Plugin } from 'vite'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}

const NOTES =
  'LAN deljeni način: strežnik na :8787, skupni db.json, preverjanje posodobitev.'

function versionJsonPlugin(): Plugin {
  return {
    name: 'nabava-version-json',
    writeBundle(options) {
      const outDir = options.dir || resolve(__dirname, 'dist')
      mkdirSync(outDir, { recursive: true })
      const payload = {
        version: pkg.version,
        builtAt: new Date().toISOString(),
        notes: NOTES,
      }
      writeFileSync(resolve(outDir, 'version.json'), JSON.stringify(payload, null, 2) + '\n')
    },
  }
}

export default defineConfig({
  base: '/nabava-orodjarna/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [versionJsonPlugin()],
})
