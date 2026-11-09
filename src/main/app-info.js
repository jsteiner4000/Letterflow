// Zielprogramm für die Pille: Name (begrenzt) und Symbol (je Exe zwischengespeichert).
const MAX_NAME = 60;

function cleanName(appName, exe) {
  let n = typeof appName === 'string' ? appName.trim() : '';
  if (!n && typeof exe === 'string')
    n = (exe.split(/[\\/]/).pop() || '').replace(/\.exe$/i, '').trim();
  if (!n) return 'Unbekanntes Programm';
  return n.length > MAX_NAME ? n.slice(0, MAX_NAME - 1) + '…' : n;
}

// getFileIcon: (exe, opts) => Promise<NativeImage> (in der App: electron.app.getFileIcon)
// scale: Bildschirmskalierung; das Symbol wird auf 28 × scale verkleinert (scharf in der Pille).
// Windows liefert für eine nicht vorhandene Exe dasselbe leere Programmsymbol wie für Programme ohne
// eigenes Symbol: damit vergleichen, statt ein Bild des Windows-Symbols mitzuführen.
const OHNE_SYMBOL = 'C:/Letterflow-gibt-es-nicht/ohne-symbol.exe';

function createAppInfo({ getFileIcon, scale = () => 1 }) {
  const cache = new Map();
  let leer = null; // Promise: Bitmap des leeren Programmsymbols oder null
  return async function getAppInfo({ exe, appName } = {}) {
    const name = cleanName(appName, exe);
    if (!exe) return { name, iconDataUrl: null };
    if (!cache.has(exe)) {
      let url = null;
      try {
        leer ??= getFileIcon(OHNE_SYMBOL, { size: 'large' }).then(
          (b) => (b.toBitmap ? b.toBitmap() : null),
          () => null,
        );
        const bild = await getFileIcon(exe, { size: 'large' });
        const ohne = await leer;
        // Leeres Symbol → null: die Pille zeigt dann das Letterflow-Symbol.
        if (!(ohne && bild.toBitmap && ohne.equals(bild.toBitmap()))) {
          const px = Math.round(28 * scale());
          url = (
            bild.resize ? bild.resize({ width: px, height: px, quality: 'best' }) : bild
          ).toDataURL();
        }
      } catch {}
      cache.set(exe, url);
    }
    return { name, iconDataUrl: cache.get(exe) };
  };
}

module.exports = { createAppInfo };
