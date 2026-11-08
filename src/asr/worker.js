// ASR-Worker: läuft als Electron-utilityProcess und erkennt Sprache mit Parakeet (sherpa-onnx).
// Nachrichten: { type: 'init', modelDir, numThreads } -> { type: 'ready' } | { type: 'error', message }
//              { type: 'transcribe', id, samples } -> { type: 'result', id, text } | { type: 'error', id, message }
const path = require('node:path');

const port = process.parentPort;
let recognizer = null;

function laden(modelDir, numThreads) {
  const sherpa = require('sherpa-onnx-node');
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    decodingMethod: 'greedy_search',
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx'),
        joiner: path.join(modelDir, 'joiner.int8.onnx'),
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
  });
}

port.on('message', ({ data }) => {
  if (data.type === 'init') {
    try {
      recognizer = laden(data.modelDir, data.numThreads);
      port.postMessage({ type: 'ready' });
    } catch (e) {
      port.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
    }
  } else if (data.type === 'transcribe') {
    try {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: data.samples, sampleRate: 16000 });
      recognizer.decode(stream);
      const text = recognizer.getResult(stream).text.trim();
      port.postMessage({ type: 'result', id: data.id, text });
    } catch (e) {
      port.postMessage({
        type: 'error',
        id: data.id,
        message: String(e && e.message ? e.message : e),
      });
    }
  }
});
