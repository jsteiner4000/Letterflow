// AudioWorklet: sammelt die Eingabe zu Paketen von ca. 100 ms (1600 Werte bei 16 kHz)
// und reicht sie ohne Kopie (Transfer) an die Seite weiter.
const PAKET = 1600;

class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.puffer = new Float32Array(PAKET);
    this.fuell = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.fuell) this.abgeben(this.puffer.slice(0, this.fuell));
        this.fuell = 0;
        this.port.postMessage('flushed');
      }
    };
  }

  abgeben(paket) {
    this.port.postMessage(paket, [paket.buffer]);
  }

  process(inputs) {
    const kanal = inputs[0] && inputs[0][0];
    if (!kanal) return true;
    let pos = 0;
    while (pos < kanal.length) {
      const n = Math.min(kanal.length - pos, PAKET - this.fuell);
      this.puffer.set(kanal.subarray(pos, pos + n), this.fuell);
      this.fuell += n;
      pos += n;
      if (this.fuell === PAKET) {
        this.abgeben(this.puffer);
        this.puffer = new Float32Array(PAKET);
        this.fuell = 0;
      }
    }
    return true;
  }
}

registerProcessor('recorder', Recorder);
