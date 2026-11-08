// Laedt die Engine-ZIPs aus engines.json, prueft SHA-256 und entpackt nach
// resources/engines/<backend>/<engine>/. Aufruf: node scripts/fetch-engines.js [--cuda]
// cuda wird nur mit --cuda geladen (wird nicht gebuendelt).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')

const root = path.join(__dirname, '..')
const engines = JSON.parse(fs.readFileSync(path.join(root, 'engines.json'), 'utf8'))
const cacheDir = path.join(root, 'resources', '_dl')
const withCuda = process.argv.includes('--cuda')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function download(entry, zipPath) {
  if (fs.existsSync(zipPath) && sha256(zipPath) === entry.sha256) return
  console.log('Lade', entry.url)
  const res = await fetch(entry.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${entry.url}`)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipPath))
  const got = sha256(zipPath)
  if (got !== entry.sha256) {
    fs.unlinkSync(zipPath)
    throw new Error(`Pruefsumme falsch fuer ${entry.url}: ${got}`)
  }
}

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true })
  for (const [backend, byEngine] of Object.entries(engines)) {
    if (backend.startsWith('_')) continue
    if (backend === 'cuda' && !withCuda) continue
    for (const [engine, entry] of Object.entries(byEngine)) {
      if (!entry) {
        console.log(`Ueberspringe ${backend}/${engine}: kein Eintrag`)
        continue
      }
      const target = path.join(root, 'resources', 'engines', backend, engine)
      if (fs.existsSync(path.join(target, entry.exe))) {
        console.log(`OK ${backend}/${engine}`)
        continue
      }
      fs.mkdirSync(target, { recursive: true })
      for (const part of [entry, ...(entry.extra || [])]) {
        const zip = path.join(cacheDir, path.basename(new URL(part.url).pathname))
        await download(part, zip)
        execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', target], { stdio: 'inherit' })
      }
      if (!fs.existsSync(path.join(target, entry.exe))) throw new Error(`exe fehlt: ${target}/${entry.exe}`)
      console.log(`Entpackt ${backend}/${engine}`)
    }
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
