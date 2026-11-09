// Liste der Dateien, die Letterflow beim ersten Start herunterladen muss.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODELS = require('../../models.json');
const ENGINES = require('../../engines.json');

// Daten-Ordner: %LOCALAPPDATA%\Letterflow, im Testmodus LETTERFLOW_DATA_DIR.
function getDataDir() {
  if (process.env.LETTERFLOW_TEST === '1' && process.env.LETTERFLOW_DATA_DIR)
    return process.env.LETTERFLOW_DATA_DIR;
  const basis = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(basis, 'Letterflow');
}

// Liefert die nötigen Dateien als [{ id, dest, url, sha256, bytes, unzipTo? }].
// `urlBase`/`overrides` ersetzen im Test Adresse (urlBase/<id>), Prüfsumme und Größe.
function requiredFiles({ backend, tier, dataDir = getDataDir(), urlBase, overrides = {} }) {
  const eintraege = MODELS.filter(
    (m) => m.id.startsWith('parakeet-') || m.id === `llama-${tier}`,
  ).map((m) => ({
    id: m.id,
    dest: path.join(dataDir, 'models', ...m.file.split('/')),
    url: m.url,
    sha256: m.sha256,
    bytes: m.bytes,
  }));

  if (tier === 'gruendlich' && backend === 'cuda') {
    const llama = ENGINES.cuda.llama;
    const unzipTo = path.join(dataDir, 'engines', 'cuda', 'llama');
    const zip = (id, quelle) => ({
      id,
      dest: path.join(dataDir, 'engines', 'cuda', path.basename(new URL(quelle.url).pathname)),
      url: quelle.url,
      sha256: quelle.sha256,
      bytes: quelle.bytes,
      unzipTo,
    });
    eintraege.push(zip('cuda-llama', llama), zip('cuda-cudart', llama.extra[0]));
  }

  return eintraege.map((e) => {
    if (!urlBase) return e;
    return { ...e, url: `${urlBase}/${e.id}`, ...overrides[e.id] };
  });
}

// Marker-Datei, die ein erfolgreich entpacktes Archiv kennzeichnet.
const markerFuer = (eintrag) => eintrag.dest + '.entpackt';

// Nur Einträge, die fehlen, unvollständig sind (Größe) oder noch entpackt werden müssen.
// Dateien liegen erst nach bestandener Prüfsumme an ihrem Ziel, die Größe genügt daher.
function missingFiles(_dataDir, liste) {
  return liste.filter((e) => {
    try {
      if (fs.statSync(e.dest).size !== e.bytes) return true;
    } catch {
      return true;
    }
    return Boolean(e.unzipTo) && !fs.existsSync(markerFuer(e));
  });
}

module.exports = { requiredFiles, missingFiles, getDataDir, markerFuer };
