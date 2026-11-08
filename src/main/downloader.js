// Datei-Download mit Fortsetzung (Range), SHA-256-Prüfung und atomarem Umbenennen.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

class DownloadError extends Error {
  constructor(code, message, ursache) {
    super(message);
    this.name = 'DownloadError';
    this.code = code; // 'network' | 'checksum' | 'disk'
    if (ursache) this.cause = ursache;
  }
}

const MAX_WEITERLEITUNGEN = 8;
const LEERLAUF_MS = 30000;

// Wirft DownloadError('disk'), wenn im Ordner weniger als `noetig` Bytes frei sind.
async function checkDiskSpace(ordner, noetig) {
  let frei;
  try {
    fs.mkdirSync(ordner, { recursive: true });
    const s = await fs.promises.statfs(ordner);
    frei = s.bavail * s.bsize;
  } catch (e) {
    throw new DownloadError('disk', `Speicherplatz nicht prüfbar: ${e.message}`, e);
  }
  if (frei < noetig) throw new DownloadError('disk', 'Nicht genug Speicherplatz');
}

// Öffnet die Antwort; folgt Weiterleitungen (Hugging Face/GitHub leiten auf CDNs um).
function anfragen(url, offset, hops = 0) {
  return new Promise((resolve, reject) => {
    const modul = url.startsWith('https:') ? https : http;
    const req = modul.get(
      url,
      { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {} },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (hops >= MAX_WEITERLEITUNGEN)
            return reject(new DownloadError('network', 'Zu viele Weiterleitungen'));
          const ziel = new URL(res.headers.location, url).toString();
          return resolve(anfragen(ziel, offset, hops + 1));
        }
        resolve(res);
      },
    );
    req.setTimeout(LEERLAUF_MS, () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', (e) => reject(new DownloadError('network', e.message, e)));
  });
}

function sha256Datei(pfad) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(pfad)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const groesse = (pfad) => {
  try {
    return fs.statSync(pfad).size;
  } catch {
    return 0;
  }
};

// Lädt `url` nach `dest` (über dest + '.part'). `bytes` (optional) dient der Platzprüfung vorab.
async function download({ url, sha256, dest, bytes, onProgress }) {
  const part = dest + '.part';
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch (e) {
    throw new DownloadError('disk', e.message, e);
  }
  let offset = groesse(part);
  // Teildatei schon vollständig (Absturz vor Prüfung/Umbenennen): ohne Anfrage prüfen.
  if (bytes && offset === bytes) {
    if ((await sha256Datei(part)) === sha256) {
      try {
        fs.renameSync(part, dest);
      } catch (e) {
        throw new DownloadError('disk', e.message, e);
      }
      if (onProgress) onProgress(bytes, bytes);
      return;
    }
    fs.rmSync(part, { force: true });
    offset = 0;
  }
  if (bytes) await checkDiskSpace(path.dirname(dest), Math.max(bytes - offset, 0));

  const res = await anfragen(url, offset);
  if (res.statusCode === 416) {
    // Teildatei passt nicht zum Server: verwerfen und neu versuchen.
    res.resume();
    fs.rmSync(part, { force: true });
    return download({ url, sha256, dest, bytes, onProgress });
  }
  if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new DownloadError('network', `Server antwortet mit ${res.statusCode}`);
  }
  // Ohne 206 sendet der Server alles von vorn.
  if (res.statusCode === 200) offset = 0;
  const laenge = Number(res.headers['content-length']);
  const total = Number.isFinite(laenge) ? offset + laenge : bytes || 0;

  let erhalten = offset;
  let schreibfehler = null;
  const out = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' });
  out.on('error', (e) => {
    schreibfehler = e;
    res.destroy();
  });
  if (onProgress) onProgress(erhalten, total);

  const vollstaendig = await new Promise((resolve) => {
    res.on('data', (chunk) => {
      erhalten += chunk.length;
      if (onProgress) onProgress(erhalten, total);
    });
    res.pipe(out);
    out.on('close', () => resolve(res.complete));
    res.on('error', () => {}); // über res.complete bewertet
    res.on('close', () => out.end()); // auch bei Abbruch Teildatei sauber schließen
  });

  if (schreibfehler) throw new DownloadError('disk', schreibfehler.message, schreibfehler);
  if (!vollstaendig || (total && erhalten !== total))
    throw new DownloadError('network', 'Verbindung unterbrochen');

  if ((await sha256Datei(part)) !== sha256) {
    fs.rmSync(part, { force: true });
    throw new DownloadError('checksum', 'Prüfsumme stimmt nicht');
  }
  try {
    fs.renameSync(part, dest);
  } catch (e) {
    throw new DownloadError('disk', e.message, e);
  }
}

module.exports = { download, DownloadError, checkDiskSpace };
