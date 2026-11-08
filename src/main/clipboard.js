// Zwischenablage sichern und nach dem Einfügen wiederherstellen (Electron 45: asynchrone API).
// Gesichert wird alles, was clipboard.read() als MIME-Typ anbietet (Text, HTML, RTF, Bilder …).
const { clipboard, ClipboardItem } = require('electron');

// Inhalte sofort auslesen: die Einträge verweisen sonst auf die gleich überschriebene Zwischenablage.
async function snapshot() {
  const items = await clipboard.read();
  const saved = await Promise.all(
    items.map(async (item) =>
      Object.fromEntries(
        await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
      ),
    ),
  );
  return { items: saved.filter((data) => Object.keys(data).length) };
}

// Nur zurückschreiben, wenn noch unser Text drinsteht – sonst hat der Nutzer inzwischen kopiert.
async function restoreIfUnchanged(snap, ourText) {
  if ((await clipboard.readText()) !== ourText) return;
  if (snap.items.length) await clipboard.write(snap.items.map((data) => new ClipboardItem(data)));
  else clipboard.clear();
}

module.exports = { snapshot, restoreIfUnchanged };
