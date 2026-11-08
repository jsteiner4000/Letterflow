const { _electron: electron } = require('@playwright/test');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Startet Letterflow im Testmodus mit eigenem (frischem) Daten-Ordner.
async function launchApp({ dataDir, env } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-test-'));
  const app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      LETTERFLOW_TEST: '1',
      LETTERFLOW_FAKE_ENGINES: '1', // Tests starten nie echte Engines
      LETTERFLOW_DATA_DIR: dir,
      ...env,
    },
  });
  // Die Test-Brücke entsteht im ready-Handler der App: darauf warten statt zu raten.
  await app.evaluate(({ app: electronApp }) => electronApp.whenReady());
  return { app, dataDir: dir };
}

// Alle Modelle liegen schon da (kleine Testdateien mit echten Prüfsummen): die Einrichtung ist
// sofort fertig, danach starten die Ersatz-Engines. Liefert Daten-Ordner und nötige Umgebung.
const MODELLDATEIEN = {
  'parakeet-encoder': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx',
  'parakeet-decoder': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx',
  'parakeet-joiner': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx',
  'parakeet-tokens': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt',
  'llama-gruendlich': 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
};
function fertigerDatenOrdner(praefix = 'letterflow-fertig-') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  const katalog = {};
  for (const [id, datei] of Object.entries(MODELLDATEIEN)) {
    const inhalt = crypto.randomBytes(2000);
    const ziel = path.join(dataDir, 'models', ...datei.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    katalog[id] = { sha256: crypto.createHash('sha256').update(inhalt).digest('hex'), bytes: 2000 };
  }
  fs.writeFileSync(path.join(dataDir, 'testkatalog.json'), JSON.stringify(katalog));
  return {
    dataDir,
    env: {
      LETTERFLOW_CATALOG_URL_BASE: 'http://127.0.0.1:9',
      LETTERFLOW_CATALOG_FILE: path.join(dataDir, 'testkatalog.json'),
    },
  };
}

// Startet eine weitere Instanz als einfachen Prozess (Playwright kann sich an eine sofort
// endende Zweitinstanz nicht anhängen). Liefert den ChildProcess.
function spawnInstance(dataDir) {
  return spawn(require('electron'), [ROOT], {
    env: {
      ...process.env,
      LETTERFLOW_TEST: '1',
      LETTERFLOW_FAKE_ENGINES: '1',
      LETTERFLOW_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });
}

module.exports = { launchApp, spawnInstance, fertigerDatenOrdner, MODELLDATEIEN };
