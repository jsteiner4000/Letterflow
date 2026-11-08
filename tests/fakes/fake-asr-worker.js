// Ersatz für src/asr/worker.js in Tests: gleiches Nachrichtenformat, kein Modell.
// Antworttext steuerbar über LETTERFLOW_FAKE_ASR_TEXT.
const port = process.parentPort;

port.on('message', ({ data }) => {
  if (data.type === 'init') {
    if (process.env.LETTERFLOW_FAKE_ASR_NIE_BEREIT === '1') return; // Test: Start bleibt hängen
    port.postMessage({ type: 'ready' });
  } else if (data.type === 'transcribe') {
    if (data.samples.length === 0) return; // Test: Worker antwortet nie (Zeitüberschreitung)
    port.postMessage({
      type: 'result',
      id: data.id,
      text: process.env.LETTERFLOW_FAKE_ASR_TEXT || 'Testtext',
    });
  }
});
