// Lokaler HTTP-Server für Download-Tests: Range-Unterstützung, wahlweise Abbruch nach N Bytes,
// wahlweise Range ignorieren, wahlweise gedrosselt (damit Fortschritt sichtbar wird).
const http = require('node:http');

// files: { '/pfad': Buffer }. server.optionen ist zur Laufzeit veränderbar.
async function startFileServer({ files, port = 0, optionen = {} }) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    const daten = files[req.url];
    const range = req.headers.range || null;
    anfragen.push({ url: req.url, range });
    if (!daten) {
      res.writeHead(404).end();
      return;
    }
    let start = 0;
    const m = /^bytes=(\d+)-$/.exec(range || '');
    if (m && !server.optionen.rangeIgnorieren) start = Number(m[1]);
    if (start >= daten.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${daten.length}` }).end();
      return;
    }
    const teil = start > 0;
    res.writeHead(teil ? 206 : 200, {
      'Content-Length': daten.length - start,
      'Content-Type': 'application/octet-stream',
      ...(teil ? { 'Content-Range': `bytes ${start}-${daten.length - 1}/${daten.length}` } : {}),
    });
    senden(res, daten.subarray(start), server.optionen);
  });
  server.optionen = optionen; // { abbruchNach, rangeIgnorieren, blockGroesse, blockPauseMs }
  server.anfragen = anfragen;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.port = server.address().port;
  server.url = `http://127.0.0.1:${server.port}`;
  server.stoppen = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return server;
}

// Schickt `daten` in Blöcken; bricht nach `abbruchNach` Bytes die Verbindung ab.
async function senden(res, daten, { abbruchNach, blockGroesse = 64 * 1024, blockPauseMs = 0 }) {
  const grenze = abbruchNach ?? daten.length;
  for (let pos = 0; pos < grenze && !res.destroyed; pos += blockGroesse) {
    const ende = Math.min(pos + blockGroesse, grenze);
    await new Promise((r) => res.write(daten.subarray(pos, ende), r));
    if (blockPauseMs) await new Promise((r) => setTimeout(r, blockPauseMs));
  }
  if (abbruchNach !== undefined && abbruchNach < daten.length) res.destroy();
  else res.end();
}

module.exports = { startFileServer };
