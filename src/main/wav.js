// WAV-Kodierung: 16-Bit-PCM, mono. Für die Engines und für Test-Fixtures.

function encodeWav(pcm, sampleRate = 16000) {
  const daten = pcm.length * 2;
  const buf = Buffer.alloc(44 + daten);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + daten, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(daten, 40);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
  }
  return buf;
}

// Liest 16-Bit-PCM-WAV (mono) als Float32Array in [-1, 1]; weitere Chunks werden übersprungen.
function decodeWav(buf) {
  if (
    buf.length < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Keine WAV-Datei');
  }
  let pos = 12;
  let format = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ') {
      format = {
        tag: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        bits: buf.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      if (!format || format.tag !== 1 || format.bits !== 16 || format.channels !== 1) {
        throw new Error('Nur 16-Bit-PCM mono wird unterstützt');
      }
      const ende = Math.min(start + size, buf.length);
      const n = Math.floor((ende - start) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2) / 32768;
      return out;
    }
    pos = start + size + (size % 2);
  }
  throw new Error('WAV ohne Daten');
}

module.exports = { encodeWav, decodeWav };
