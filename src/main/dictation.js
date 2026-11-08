// Diktat-Ablauf: Kürzel gedrückt → Aufnahme → Abschnitte erkennen → glätten → einfügen (oder warnen).
// Diktate laufen nacheinander: ein neues Diktat darf aufnehmen, während das vorige noch verarbeitet
// wird; eingefügt wird immer in der Reihenfolge der Aufnahmen.
const { clipboard } = require('electron');
const { createSegmenter } = require('./vad');
const { normalizeLevel, createTranscriptQueue } = require('./transcriber');
const { polish } = require('./smoother');
const { snapshot, restoreIfUnchanged } = require('./clipboard');

const MIN_DURATION_MS = 300;
const MAX_DURATION_MS = 5 * 60 * 1000;
const INFO_MS = 2000;
const WARNING_MS = 4000;
const HELPER_FAILED_MS = 10000;
const RESTORE_DELAY_MS = 400;

const MESSAGES = {
  setup: 'Einrichtung noch nicht abgeschlossen',
  loading: 'Letterflow lädt noch die Modelle …',
  limit: 'Maximal 5 Minuten – Aufnahme beendet',
  noTextField: 'Kein Textfeld aktiv – Text liegt in der Zwischenablage',
  windowChanged: 'Fenster gewechselt – Text liegt in der Zwischenablage',
  micBlocked:
    'Mikrofon gesperrt – in Windows unter Datenschutz › Mikrofon für Desktop-Apps erlauben',
  noMic: 'Kein Mikrofon gefunden',
  micFailed: 'Mikrofon konnte nicht gestartet werden',
  helperFailed: 'Tastenkürzel nicht verfügbar – Letterflow bitte neu starten',
  failed: 'Diktat fehlgeschlagen – bitte erneut versuchen',
};

// Gerät fehlt oder ist weg: einmal mit dem Windows-Standardgerät neu versuchen.
const DEVICE_GONE = new Set(['NotFoundError', 'OverconstrainedError', 'TrackEndedError']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Dictation {
  constructor({
    helper,
    overlay,
    getEngines,
    getStatus,
    getSettings,
    showSetup,
    restartEngines,
    log,
  }) {
    Object.assign(this, {
      helper,
      overlay,
      getEngines,
      getStatus,
      getSettings,
      showSetup,
      restartEngines,
      log,
    });
    this.recording = null; // Diktat, dessen Kürzel gerade gehalten wird
    this.capture = null; // Diktat, das gerade PCM vom Mikrofon bekommt
    this.recorderChain = Promise.resolve(); // Start/Stopp des Mikrofons nacheinander
    this.pasteChain = Promise.resolve(); // Einfügen in Reihenfolge
    this.busy = 0; // Diktate in Verarbeitung
    this.messageTimer = null;
    this.pendingMessage = null; // Meldung, die nach der laufenden Aufnahme nachgeholt wird
    this.keysReleased = Promise.resolve(); // Einfügen erst, wenn das Kürzel losgelassen ist
    this.releaseKeys = () => {};
    this.helperHandlers = {
      'hotkey-down': () => this._down(),
      'hotkey-up': () => this._up(),
      'hotkey-cancel': () => this._cancel(),
      failed: () => {
        this.log('helfer: ausgefallen');
        this._message('fehler', MESSAGES.helperFailed, HELPER_FAILED_MS);
      },
    };
    this.overlayHandlers = {
      pcm: (pcm) => this._pcm(pcm),
      'recorder-error': (e) => this._recorderError(e.name),
    };
    for (const [n, f] of Object.entries(this.helperHandlers)) helper.on(n, f);
    for (const [n, f] of Object.entries(this.overlayHandlers)) overlay.on(n, f);
  }

  dispose() {
    for (const [n, f] of Object.entries(this.helperHandlers)) this.helper.off(n, f);
    for (const [n, f] of Object.entries(this.overlayHandlers)) this.overlay.off(n, f);
    clearTimeout(this.messageTimer);
    const rec = this.recording;
    if (rec) {
      this._end(rec);
      this._stopRecorder(rec);
    }
  }

  // --- Kürzel ------------------------------------------------------------------

  _down() {
    // Auch ohne Aufnahme maskieren, sonst öffnet das Loslassen von Win das Startmenü.
    this.helper.setMask(true);
    this.releaseKeys();
    this.keysReleased = new Promise((resolve) => (this.releaseKeys = resolve));
    if (this.recording) return;
    const status = this.getStatus().engines;
    if (status === 'fehlt') {
      this._message('info', MESSAGES.setup, INFO_MS);
      this.showSetup();
      return;
    }
    if (status !== 'bereit') {
      if (status === 'fehler') {
        this.log('engines: neustart angestoßen');
        this.restartEngines();
      }
      this._message('info', MESSAGES.loading, INFO_MS);
      return;
    }
    const settings = this.getSettings();
    const rec = {
      startedAt: Date.now(),
      deviceId: settings.micDeviceId || null,
      retried: false,
      segmenter: createSegmenter(),
      // Engines zur Laufzeit holen: nach einem Neustart ist es ein neues Objekt.
      queue: createTranscriptQueue(async (samples) => {
        try {
          return await this.getEngines().transcribe(samples);
        } catch (e) {
          rec.failed = true;
          throw e;
        }
      }),
      focus: this.helper.focus(),
    };
    this.recording = rec;
    clearTimeout(this.messageTimer);
    this.messageTimer = null;
    this.overlay.show({ kind: 'aufnahme' });
    rec.limitTimer = setTimeout(() => this._finish(rec, true), MAX_DURATION_MS);
    this._startRecorder(rec, rec.deviceId);
  }

  _up() {
    this.helper.setMask(false);
    this.releaseKeys();
    if (this.recording) this._finish(this.recording, false);
  }

  _cancel() {
    this.helper.setMask(false);
    this.releaseKeys();
    const rec = this.recording;
    if (!rec) return;
    this._end(rec);
    this.log(`diktat: abgebrochen nach ${Date.now() - rec.startedAt} ms`);
    this._stopRecorder(rec);
    this._idle();
  }

  // --- Mikrofon ----------------------------------------------------------------

  _startRecorder(rec, deviceId) {
    this.recorderChain = this.recorderChain.then(async () => {
      if (this.recording !== rec) return; // inzwischen beendet
      this.capture = rec;
      await this.overlay.startRecording(deviceId).catch((e) => {
        console.error('Aufnahme nicht gestartet:', e.message);
        this._recorderError('Error');
      });
    });
  }

  // Wartet, bis das Mikrofon zu ist und alle PCM-Pakete dieses Diktats angekommen sind.
  _stopRecorder(rec) {
    this.recorderChain = this.recorderChain.then(async () => {
      if (this.capture !== rec) return;
      await this.overlay.stopRecording();
      this.capture = null;
    });
    return this.recorderChain;
  }

  _pcm(pcm) {
    const rec = this.capture;
    if (!rec) return;
    rec.gotAudio = true;
    for (const seg of rec.segmenter.push(pcm)) rec.queue.add(normalizeLevel(seg), true);
    if (rec === this.recording) this.overlay.level(rec.segmenter.level);
  }

  _recorderError(name) {
    const rec = this.capture;
    if (!rec) return;
    this.capture = null;
    this.log(`mikrofon: ${name}`);
    const canRetry = name === 'TrackEndedError' || rec.deviceId !== null;
    if (this.recording === rec && DEVICE_GONE.has(name) && canRetry && !rec.retried) {
      rec.retried = true;
      rec.deviceId = null;
      this.log('mikrofon: neuer Versuch mit Windows-Standardgerät');
      this._startRecorder(rec, null);
      return;
    }
    if (this.recording !== rec) return; // Aufnahme war schon beendet: Rest wird normal verarbeitet
    this._end(rec);
    const text =
      name === 'NotAllowedError'
        ? MESSAGES.micBlocked
        : DEVICE_GONE.has(name)
          ? MESSAGES.noMic
          : MESSAGES.micFailed;
    this._message('fehler', text, WARNING_MS);
    // Schon Aufgenommenes nicht verwerfen (z. B. Gerät nach 30 s abgezogen).
    if (rec.gotAudio) this._finish(rec, false);
  }

  // --- Verarbeitung ------------------------------------------------------------

  _end(rec) {
    clearTimeout(rec.limitTimer);
    if (this.recording === rec) this.recording = null;
  }

  _finish(rec, limitReached) {
    this._end(rec);
    // Bei Erreichen der Höchstdauer bleibt die Maske bis zum echten Loslassen bestehen.
    if (limitReached) this._message('info', MESSAGES.limit, INFO_MS);
    this.busy += 1;
    const job = this._transcribe(rec, Date.now() - rec.startedAt);
    this.pasteChain = this.pasteChain.then(() => this._deliver(job));
  }

  // Liefert { text, focus } oder null (nichts einzufügen).
  async _transcribe(rec, durationMs) {
    await this._stopRecorder(rec);
    const tail = rec.segmenter.flush();
    this.log(`diktat: aufnahme ${durationMs} ms`);
    if (durationMs < MIN_DURATION_MS || !rec.segmenter.hadSpeech) {
      this.log('diktat: verworfen (zu kurz oder still)');
      return null;
    }
    if (tail) rec.queue.add(normalizeLevel(tail), true);
    this._idle();
    let t = Date.now();
    const raw = await rec.queue.finish();
    this.log(`diktat: erkennung ${Date.now() - t} ms${rec.failed ? ', mit fehlern' : ''}`);
    if (!raw && rec.failed) throw new Error('Spracherkennung fehlgeschlagen');
    if (!raw) return null;
    const settings = this.getSettings();
    const engines = this.getEngines();
    t = Date.now();
    const text = await polish(raw, {
      tier: engines && engines.tier,
      enabled: settings.smoothing,
      dictionary: settings.dictionary,
      llamaUrl: engines && engines.llamaUrl,
      llamaKey: engines && engines.llamaKey,
    });
    this.log(`diktat: glättung ${Date.now() - t} ms`);
    if (!text || !text.trim()) return null;
    return { text, focus: await rec.focus };
  }

  async _deliver(job) {
    let restore = null;
    let result = null;
    try {
      result = await job;
      // Hält der Nutzer schon das nächste Kürzel, würde STRG+V mit gedrückten Tasten ankommen.
      if (result) await this.keysReleased;
      if (result) restore = await this._insert(result);
    } catch (e) {
      console.error('Diktat fehlgeschlagen:', e);
      this.log(`diktat: fehler ${e && e.name}`);
      // Nie still verlieren: vorhandenen Text in die Zwischenablage, sonst Fehlermeldung.
      const saved =
        result &&
        (await clipboard.writeText(result.text).then(
          () => true,
          () => false,
        ));
      if (saved) this._message('warnung', MESSAGES.noTextField, WARNING_MS);
      else this._message('fehler', MESSAGES.failed, WARNING_MS);
    } finally {
      this.busy -= 1;
      this._idle();
    }
    // Erst wiederherstellen, wenn die Zielanwendung STRG+V sicher verarbeitet hat.
    if (restore) {
      await sleep(RESTORE_DELAY_MS);
      await restore().catch((e) => console.error('Zwischenablage nicht wiederhergestellt:', e));
    }
  }

  // Fügt ein oder legt den Text in die Zwischenablage und warnt. Liefert die Wiederherstellung.
  async _insert({ text, focus }) {
    const t = Date.now();
    if (focus.editable === 'no') {
      await clipboard.writeText(text);
      this.log('diktat: einfügen 0 ms, kein-textfeld');
      this._message('warnung', MESSAGES.noTextField, WARNING_MS);
      return null;
    }
    // Sichern darf scheitern: dann wird nur nicht wiederhergestellt.
    const snap = await snapshot().catch(() => null);
    await clipboard.writeText(text);
    const r = await this.helper.paste(focus.hwnd);
    this.log(
      `diktat: einfügen ${Date.now() - t} ms, ${r.ok ? 'ok' : r.reason || 'fehlgeschlagen'}`,
    );
    if (r.ok) return snap && (() => restoreIfUnchanged(snap, text));
    const windowChanged = r.reason === 'fenster-gewechselt';
    this._message(
      'warnung',
      windowChanged ? MESSAGES.windowChanged : MESSAGES.noTextField,
      WARNING_MS,
    );
    return null;
  }

  // --- Pille -------------------------------------------------------------------

  // Während einer Aufnahme wird die (letzte) Meldung gemerkt und danach gezeigt.
  _message(kind, text, ms) {
    if (this.recording) {
      this.pendingMessage = [kind, text, ms];
      return;
    }
    clearTimeout(this.messageTimer);
    this.overlay.show({ kind, text });
    this.messageTimer = setTimeout(() => {
      this.messageTimer = null;
      this._idle();
    }, ms);
  }

  // Ruhezustand der Pille: Aufnahme und Meldungen haben Vorrang, sonst „Schreibe …“ oder aus.
  _idle() {
    if (this.recording || this.messageTimer) return;
    if (this.pendingMessage) {
      const [kind, text, ms] = this.pendingMessage;
      this.pendingMessage = null;
      this._message(kind, text, ms);
    } else if (this.busy > 0) this.overlay.show({ kind: 'verarbeitung' });
    else this.overlay.hide();
  }
}

module.exports = { Dictation, MESSAGES };
