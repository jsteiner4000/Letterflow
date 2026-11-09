const { EventEmitter } = require('node:events');

const START_FRIST_MS = 5000;
const STOPP_WARTEZEIT_MS = 2000;

// Mikrofon über den nativen Helfer (WASAPI, 16 kHz mono Float). Die PCM-Pakete kommen als 'pcm'
// (Float32Array) heraus, Fehler als 'recorder-error' ({ name } wie im Browser). Audio fließt nur während
// einer Aufnahme; danach bleibt das Gerät warmMs geöffnet, aber gestoppt (kein Ton, kein Mikrofon-Symbol
// von Windows): der nächste Start dauert dann ~10 ms statt ~0,2 s. `warm`: war der letzte Start warm?
function createRecorder(helper, { warmMs = 15000 } = {}) {
  const events = new EventEmitter();
  let aktiv = false;
  const wartende = new Set(); // { pruefen, fertig }
  events.warm = false;

  const handler = {
    pcm: (pcm) => events.emit('pcm', pcm),
    mic: (m) => {
      if (m.started) events.warm = m.warm;
      if (m.error && aktiv) {
        aktiv = false;
        events.emit('recorder-error', { name: m.error });
      }
      for (const w of [...wartende]) if (w.pruefen(m)) w.fertig();
    },
  };
  for (const [n, f] of Object.entries(handler)) helper.on(n, f);

  const abwarten = (frist, pruefen) =>
    new Promise((resolve) => {
      const w = {
        pruefen,
        fertig: () => {
          clearTimeout(timer);
          wartende.delete(w);
          resolve();
        },
      };
      const timer = setTimeout(w.fertig, frist);
      wartende.add(w);
    });

  Object.assign(events, {
    async start(deviceId) {
      aktiv = true;
      const gemeldet = abwarten(START_FRIST_MS, (m) => m.started || m.error);
      helper.mic(true, deviceId || null, warmMs);
      await gemeldet;
    },
    // Wartet, bis der Helfer das letzte Paket geliefert und das Mikrofon gestoppt hat.
    async stop() {
      if (!aktiv) return;
      aktiv = false;
      const gemeldet = abwarten(STOPP_WARTEZEIT_MS, (m) => m.stopped);
      helper.mic(false);
      await gemeldet;
    },
    destroy() {
      for (const [n, f] of Object.entries(handler)) helper.off(n, f);
    },
  });
  Object.defineProperty(events, 'aktiv', { get: () => aktiv });
  return events;
}

module.exports = { createRecorder };
