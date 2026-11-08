// Spike Parakeet v3 (sherpa-onnx, int8, CPU) gegen Whisper large-v3-turbo (CPU).
// Aufruf:
//   SHERPA_NODE_DIR=<ordner mit node_modules/sherpa-onnx-node> node scripts/bench-parakeet.js parakeet --threads 8 [--runs 3]
//   node scripts/bench-parakeet.js whisper --lang de|auto [--runs 3]
//   node scripts/bench-parakeet.js score
// Testclips: testdata/testset/*.wav (scripts/make-testset.ps1); Referenzen: scripts/bench-clips.json
// Ergebnis: test-results/spike-<name>.json
const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const mode = process.argv[2]
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 ? process.argv[i + 1] : d
}
const RUNS = Number(arg('runs', 3))
const modelDir = path.join(process.env.LOCALAPPDATA, 'Letterflow', 'models')
const clips = JSON.parse(fs.readFileSync(path.join(__dirname, 'bench-clips.json'), 'utf8'))
const ids = []
for (const c of clips) {
  ids.push(c.id)
  if (c.cat === 'mixed') ids.push(c.id + 'h')
}
if (arg('ids', '')) { const keep = arg('ids').split(','); ids.splice(0, ids.length, ...keep) }
const wavPath = (id) => path.join(root, 'testdata', 'testset', id + '.wav')
const outFile = (n) => path.join(root, 'test-results', `spike-${n}.json`)
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r1 = (x) => Math.round(x * 10) / 10

function readWav(file) {
  const b = fs.readFileSync(file)
  let p = 12
  let data = null
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4)
    const sz = b.readUInt32LE(p + 4)
    if (id === 'data') {
      data = b.subarray(p + 8, p + 8 + sz)
      break
    }
    p += 8 + sz + (sz & 1)
  }
  const s = new Float32Array(data.length / 2)
  for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(i * 2) / 32768
  return s
}

async function benchParakeet() {
  const threads = Number(arg('threads', 8))
  const sherpa = require(path.join(process.env.SHERPA_NODE_DIR, 'node_modules', 'sherpa-onnx-node'))
  const d = path.join(modelDir, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8')
  const t0 = performance.now()
  const rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: path.join(d, 'encoder.int8.onnx'), decoder: path.join(d, 'decoder.int8.onnx'), joiner: path.join(d, 'joiner.int8.onnx') },
      tokens: path.join(d, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer'
    }
  })
  const loadMs = performance.now() - t0
  const ramAfterLoadMiB = Math.round(process.resourceUsage().maxRSS / 1024)
  const decode = (samples) => {
    const t = performance.now()
    const st = rec.createStream()
    st.acceptWaveform({ samples, sampleRate: 16000 })
    rec.decode(st)
    const r = rec.getResult(st)
    return { ms: performance.now() - t, text: r.text, lang: r.lang }
  }
  const out = []
  let firstMs = null
  for (const id of ids) {
    const samples = readWav(wavPath(id))
    if (firstMs === null) firstMs = decode(samples).ms // erster Lauf nach dem Laden (Aufwärmen), nicht gezählt
    const times = []
    let res
    for (let i = 0; i < RUNS; i++) {
      res = decode(samples)
      times.push(res.ms)
    }
    out.push({ id, durS: r1(samples.length / 16000), medianMs: r1(median(times)), runsMs: times.map(r1), text: res.text.trim(), lang: res.lang })
    console.log(id, out[out.length - 1].durS + 's', out[out.length - 1].medianMs + ' ms', res.text.trim())
  }
  const result = { engine: 'parakeet-int8', threads, loadMs: r1(loadMs), firstDecodeMs: r1(firstMs), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), ramAfterLoadMiB, clips: out }
  fs.mkdirSync(path.dirname(outFile('x')), { recursive: true })
  fs.writeFileSync(outFile('parakeet-t' + threads), JSON.stringify(result, null, 1))
  console.log({ threads, loadMs: result.loadMs, firstDecodeMs: result.firstDecodeMs, ramAfterLoadMiB, peakRssMiB: result.peakRssMiB })
}

const freePort = () =>
  new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })

async function benchWhisper() {
  const lang = arg('lang', 'de')
  const threads = Number(arg('threads', 8))
  const exe = path.join(root, 'resources', 'engines', 'cpu', 'whisper', 'Release', 'whisper-server.exe')
  const port = await freePort()
  const args = ['-m', path.join(modelDir, 'ggml-large-v3-turbo-q5_0.bin'), '--host', '127.0.0.1', '--port', String(port), '-t', String(threads), '-l', lang, '-nt', '-ng']
  const t0 = performance.now()
  const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: true })
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  const readyMs = performance.now() - t0
  const out = []
  try {
    for (const id of ids) {
      const wav = fs.readFileSync(wavPath(id))
      const times = []
      let j
      for (let i = 0; i < RUNS; i++) {
        const fd = new FormData()
        fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'a.wav')
        fd.append('temperature', '0.0')
        fd.append('response_format', 'verbose_json')
        const t = performance.now()
        const r = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd })
        j = await r.json()
        times.push(performance.now() - t)
      }
      out.push({ id, medianMs: r1(median(times)), runsMs: times.map(r1), text: (j.text || '').trim(), lang: j.language })
      console.log(id, out[out.length - 1].medianMs + ' ms', out[out.length - 1].lang, out[out.length - 1].text)
    }
    let peak = null
    try {
      peak = Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).PeakWorkingSet64`], { encoding: 'utf8' })) / 1048576)
    } catch {}
    const result = { engine: 'whisper-large-v3-turbo-q5_0', lang, threads, readyMs: r1(readyMs), peakRamMiB: peak, clips: out }
    fs.mkdirSync(path.dirname(outFile('x')), { recursive: true })
    fs.writeFileSync(outFile('whisper-' + lang + (arg('ids', '') ? '-subset' : '')), JSON.stringify(result, null, 1))
    console.log({ lang, readyMs: result.readyMs, peakRamMiB: peak })
  } finally {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  }
}

// WER: klein, Satzzeichen weg, Bindestrich = Leerzeichen, Ziffer "10" = "zehn" (Parakeet schreibt Zahlen als Ziffern)
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[-–]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\b10\b/g, 'zehn')
    .split(/\s+/)
    .filter(Boolean)
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
function score() {
  const refOf = (id) => clips.find((c) => c.id === id.replace(/(mx\d)h$/, '$1'))
  const groupOf = (id) => (/^mx\dh$/.test(id) ? 'mixed-hedda' : refOf(id).cat === 'mixed' ? 'mixed-switch' : refOf(id).cat)
  const files = fs.readdirSync(path.join(root, 'test-results')).filter((f) => /^spike-(parakeet-t\d+|whisper-(de|auto))\.json$/.test(f))
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'test-results', f), 'utf8'))
    const g = {}
    for (const c of r.clips) {
      const ref = norm(refOf(c.id).ref)
      const e = lev(ref, norm(c.text))
      const k = groupOf(c.id)
      g[k] = g[k] || { err: 0, n: 0 }
      g[k].err += e
      g[k].n += ref.length
      c.wer = r1((100 * e) / ref.length)
    }
    console.log(f)
    for (const [k, v] of Object.entries(g)) console.log('  ', k, `WER ${r1((100 * v.err) / v.n)} % (${v.err}/${v.n})`)
    console.log('   je Clip:', r.clips.map((c) => `${c.id}=${c.wer}`).join(' '))
  }
}

;({ parakeet: benchParakeet, whisper: benchWhisper, score }[mode] || (() => console.log('Modus: parakeet|whisper|score')))()
