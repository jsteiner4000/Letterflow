// Hardware-Erkennung: Grafikgeräte (llama-server --list-devices), Grafikspeicher (Registry),
// daraus Backend (cpu/vulkan/cuda) und Glättungsstufe (schnell/ausgewogen/gruendlich).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const SOFTWARE_RENDERER = /llvmpipe|lavapipe|swiftshader|software|microsoft basic/i;
const GRUENDLICH_MIN_VRAM_MIB = 6144;
// „8 GB“-Rechner melden wegen reservierten Grafikspeichers weniger; 7 GiB lässt sie durch.
const AUSGEWOGEN_MIN_RAM = 7 * 1024 ** 3;
const AUSGEWOGEN_MIN_THREADS = 8; // ≈ 4 Kerne (2 Threads je Kern, wie in engines.js angenommen)
const ABFRAGE_TIMEOUT_MS = 10000;

function vendorVon(name) {
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b/i.test(name)) return 'nvidia';
  if (/\bamd\b|radeon|\bati\b/i.test(name)) return 'amd';
  if (/intel/i.test(name)) return 'intel';
  return 'other';
}

// Zeilen wie "  Vulkan0: AMD Radeon (TM) Graphics (8142 MiB, 7734 MiB free)". Die MiB-Angabe
// wird bewusst ignoriert: bei iGPUs ist sie geteilter Arbeitsspeicher, kein Grafikspeicher.
function parseDevices(text) {
  const geraete = [];
  for (const zeile of String(text).split(/\r?\n/)) {
    const m = /^\s+[A-Za-z]+\d+:\s+(.+?)(?:\s+\(\d+ MiB[^)]*\))?\s*$/.exec(zeile);
    if (!m) continue;
    const name = m[1].trim();
    if (SOFTWARE_RENDERER.test(name)) continue;
    geraete.push({ name, vendor: vendorVon(name) });
  }
  return geraete;
}

// Größter Wert von HardwareInformation.qwMemorySize (REG_QWORD, Bytes) in MiB; nichts → 0.
function parseDedicatedVram(text) {
  let groesstes = 0n;
  const re = /HardwareInformation\.qwMemorySize\s+REG_QWORD\s+(0x[0-9a-fA-F]+|\d+)/g;
  for (const m of String(text).matchAll(re)) {
    const wert = BigInt(m[1]);
    if (wert > groesstes) groesstes = wert;
  }
  return Number(groesstes / 1048576n);
}

function chooseBackend(devices, cudaInstalled) {
  if (devices.some((d) => d.vendor === 'nvidia')) return cudaInstalled ? 'cuda' : 'vulkan';
  return devices.length ? 'vulkan' : 'cpu';
}

function chooseSmoothingTier(
  devices,
  dedicatedVramMiB,
  setting,
  { ramBytes = 0, threads = 0 } = {}, // aus detectHardware
) {
  if (['schnell', 'ausgewogen', 'gruendlich'].includes(setting)) return setting;
  if (devices.some((d) => d.vendor === 'nvidia') || dedicatedVramMiB >= GRUENDLICH_MIN_VRAM_MIB)
    return 'gruendlich';
  return ramBytes >= AUSGEWOGEN_MIN_RAM && threads >= AUSGEWOGEN_MIN_THREADS
    ? 'ausgewogen'
    : 'schnell';
}

// Ordner der gebündelten Engines (Entwicklung: resources/, paketiert: Ressourcen-Ordner).
function bundledEnginesDir() {
  const basis =
    !process.defaultApp && process.resourcesPath
      ? process.resourcesPath
      : path.join(__dirname, '..', '..', 'resources');
  return path.join(basis, 'engines');
}

async function geraeteAuslesen(vulkanExe) {
  try {
    const { stdout } = await promisify(execFile)(vulkanExe, ['--list-devices'], {
      timeout: ABFRAGE_TIMEOUT_MS,
      windowsHide: true,
      cwd: path.dirname(vulkanExe),
    });
    return parseDevices(stdout);
  } catch {
    return [];
  }
}

async function vramAuslesen() {
  const klasse =
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  try {
    const { stdout } = await promisify(execFile)(
      'reg',
      ['query', klasse, '/s', '/v', 'HardwareInformation.qwMemorySize'],
      { timeout: ABFRAGE_TIMEOUT_MS, windowsHide: true, encoding: 'latin1' },
    );
    return parseDedicatedVram(stdout);
  } catch {
    return 0;
  }
}

// Liefert { backend, tier, devices, dedicatedVramMiB, ramBytes, threads }. `dataDir` dient nur dazu, eine
// nachgeladene CUDA-Engine zu finden.
async function detectHardware(setting, { dataDir } = {}) {
  if (process.env.LETTERFLOW_FAKE_ENGINES === '1')
    return {
      backend: 'cpu',
      tier: 'schnell',
      devices: [],
      dedicatedVramMiB: 0,
      ramBytes: 0,
      threads: 0,
    };
  const [devices, dedicatedVramMiB] = await Promise.all([
    geraeteAuslesen(path.join(bundledEnginesDir(), 'vulkan', 'llama', 'llama-server.exe')),
    vramAuslesen(),
  ]);
  const cudaInstalled = Boolean(
    dataDir && fs.existsSync(path.join(dataDir, 'engines', 'cuda', 'llama', 'llama-server.exe')),
  );
  const rechner = { ramBytes: os.totalmem(), threads: os.availableParallelism() };
  return {
    backend: chooseBackend(devices, cudaInstalled),
    tier: chooseSmoothingTier(devices, dedicatedVramMiB, setting, rechner),
    devices,
    dedicatedVramMiB,
    ...rechner,
  };
}

module.exports = {
  parseDevices,
  parseDedicatedVram,
  chooseBackend,
  chooseSmoothingTier,
  detectHardware,
  bundledEnginesDir,
};
