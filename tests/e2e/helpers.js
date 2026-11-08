const { _electron: electron } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Startet Letterflow im Testmodus mit eigenem (frischem) Daten-Ordner.
async function launchApp({ dataDir, env } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-test-'));
  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, LETTERFLOW_TEST: '1', LETTERFLOW_DATA_DIR: dir, ...env },
  });
  return { app, dataDir: dir };
}

// Startet eine weitere Instanz als einfachen Prozess (Playwright kann sich an eine sofort
// endende Zweitinstanz nicht anhängen). Liefert den ChildProcess.
function spawnInstance(dataDir) {
  return spawn(require('electron'), [ROOT], {
    env: { ...process.env, LETTERFLOW_TEST: '1', LETTERFLOW_DATA_DIR: dataDir },
    stdio: 'ignore',
  });
}

module.exports = { launchApp, spawnInstance };
