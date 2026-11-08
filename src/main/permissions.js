const { pathToFileURL } = require('node:url');
const path = require('node:path');

const RENDERER_URL = pathToFileURL(path.join(__dirname, '..', 'renderer')).href;

// Erlaubt wird nur das Mikrofon (reines Audio) für die eigenen Seiten der App; alles andere nicht.
function isAllowed(permission, url, mediaTypes) {
  if (permission !== 'media') return false;
  if (typeof url !== 'string' || !url.startsWith(`${RENDERER_URL}/`)) return false;
  // Ohne Angabe (z. B. Geräteliste) ist es nur eine Abfrage; Video ist nie erlaubt.
  return !(mediaTypes || []).some((t) => t !== 'audio');
}

function setupPermissions(session) {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isAllowed(permission, details.requestingUrl || webContents.getURL(), details.mediaTypes),
    );
  });
  session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    const url = (details && details.requestingUrl) || (webContents && webContents.getURL());
    const art = details && details.mediaType;
    return isAllowed(permission, url, art && art !== 'unknown' ? [art] : []);
  });
}

module.exports = { isAllowed, setupPermissions };
