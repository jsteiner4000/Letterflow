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
// scale: Bildschirmskalierung; das Symbol wird auf 36 × scale verkleinert (so groß wie in pille.css, sonst unscharf).
// Windows liefert für eine nicht vorhandene Exe dasselbe leere Programmsymbol wie für Programme ohne
// eigenes Symbol: damit vergleichen, statt ein Bild des Windows-Symbols mitzuführen.
const OHNE_SYMBOL = 'C:/Letterflow-gibt-es-nicht/ohne-symbol.exe';

// loadImage: (pngPfad) => NativeImage (electron.nativeImage.createFromPath). Paket-Apps (Store, WhatsApp)
// tragen kein Symbol in der Exe; der Helfer meldet dann die Logo-Datei aus dem Paket als icon. Liefert die
// Exe nur das leere Standardsymbol (Office: WINWORD.EXE), gilt das Fenstersymbol (fensterIcon, PNG).
function createAppInfo({ getFileIcon, loadImage = null, scale = () => 1 }) {
  const cache = new Map();
  let leer = null; // Promise: Bitmap des leeren Programmsymbols oder null
  const png = (p) => {
    const b = typeof p === 'string' && /\.png$/i.test(p) && loadImage?.(p);
    return b && !b.isEmpty() ? b : null;
  };
  return async function getAppInfo({ exe, appName, icon, fensterIcon } = {}) {
    const name = cleanName(appName, exe);
    if (!exe) return { name, iconDataUrl: null };
    if (!cache.has(exe)) {
      let url = null;
      try {
        leer ??= getFileIcon(OHNE_SYMBOL, { size: 'large' }).then(
          (b) => (b.toBitmap ? b.toBitmap() : null),
          () => null,
        );
        let bild = png(icon);
        if (!bild) {
          const datei = await getFileIcon(exe, { size: 'large' });
          const ohne = await leer;
          // Leeres Symbol → Fenstersymbol, sonst null: die Pille zeigt dann das Letterflow-Symbol.
          bild = ohne && datei.toBitmap && ohne.equals(datei.toBitmap()) ? png(fensterIcon) : datei;
        }
        if (bild) {
          const px = Math.round(36 * scale());
          url = (
            bild.resize ? bild.resize({ width: px, height: px, quality: 'best' }) : bild
          ).toDataURL();
        }
      } catch {}
      // Ohne Symbol und ohne Fenstersymbol nicht merken: beim nächsten Mal kann das Fenster eins haben.
      if (url || fensterIcon) cache.set(exe, url);
      else return { name, iconDataUrl: null };
    }
    return { name, iconDataUrl: cache.get(exe) };
  };
}

module.exports = { createAppInfo };
