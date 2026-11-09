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
function createAppInfo({ getFileIcon }) {
  const cache = new Map();
  return async function getAppInfo({ exe, appName } = {}) {
    const name = cleanName(appName, exe);
    if (!exe) return { name, iconDataUrl: null };
    if (!cache.has(exe)) {
      let url = null;
      try {
        url = (await getFileIcon(exe, { size: 'small' })).toDataURL();
      } catch {}
      cache.set(exe, url);
    }
    return { name, iconDataUrl: cache.get(exe) };
  };
}

module.exports = { createAppInfo };
