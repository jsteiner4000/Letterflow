// Ersatz für llama-server in Tests (läuft mit ELECTRON_RUN_AS_NODE): versteht --host, --port,
// --api-key und beantwortet GET /health mit 200. Alles andere verlangt den Schlüssel.
const http = require('node:http');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const key = arg('--api-key');

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"status":"ok"}');
    }
    if (key && req.headers.authorization !== `Bearer ${key}`) {
      res.writeHead(401);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Testantwort' } }] }));
  })
  .listen(Number(arg('--port')), arg('--host') || '127.0.0.1');
