// App-Protokoll: nur Ereignisse und Dauern, nie diktierter Text. Ab 1 MB wird die Datei zu .1.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

function createLog(dir) {
  const file = path.join(dir, 'letterflow.log');
  return (line) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {}
      if (size >= MAX_BYTES) fs.renameSync(file, file + '.1'); // ersetzt eine ältere .1
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch (e) {
      console.error('Protokoll nicht geschrieben:', e.message);
    }
  };
}

module.exports = { createLog };
