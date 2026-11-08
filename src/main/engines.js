// Engine-Verwaltung: ASR-Worker (Parakeet über sherpa-onnx im utilityProcess) und optional
// llama-server für die gründliche Glättung. Überwacht beide, startet sie nach Abstürzen neu
// und räumt verwaiste llama-server-Prozesse einer früheren Sitzung ab.
const { EventEmitter } = require('node:events');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const MODELS = require('../../models.json');
const { bundledEnginesDir } = require('./hardware');

const PARAKEET_ORDNER = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';
const LLAMA_EXE = 'llama-server.exe';
const NEUSTART_VERZOEGERUNG_MS = [1000, 3000, 10000];
const ABSTURZ_FENSTER_MS = 60000;
const MAX_ABSTUERZE = 3;
const TRANSCRIBE_TIMEOUT_MS = 30000;
const BEREIT_TIMEOUT_MS = 180000; // Modell laden dauert Sekunden, auf langsamen Platten länger
const HEALTH_INTERVALL_MS = 200;
const BEENDEN_TIMEOUT_MS = 5000;

const fakeModus = () => process.env.LETTERFLOW_FAKE_ENGINES === '1';
const FAKES = path.join(__dirname, '..', '..', 'tests', 'fakes');

const standardThreads = () => Math.min(8, Math.max(2, Math.floor(os.availableParallelism() / 2)));
// Physische Kerne für llama-server (Annahme: 2 Threads je Kern, wie bei Ryzen/Core mit SMT).
const physischeKerne = () => Math.max(1, Math.floor(os.availableParallelism() / 2));

function freierPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

class EngineManager extends EventEmitter {
  constructor({
    dataDir,
    backend,
    tier,
    threads,
    prepare,
    restartDelaysMs,
    transcribeTimeoutMs,
    aufraeumVerzoegerungMs,
  }) {
    super();
    this.dataDir = dataDir;
    this.backend = backend;
    this.tier = tier;
    this.threads = threads ?? standardThreads();
    this._prepare = prepare; // async ({ backend, tier }): Dateien für die Stufe nachladen
    this._verzoegerungen = restartDelaysMs || NEUSTART_VERZOEGERUNG_MS;
    this._transcribeTimeoutMs = transcribeTimeoutMs || TRANSCRIBE_TIMEOUT_MS;
    this._fake = fakeModus();
    this._status = 'startet';
    this._worker = null;
    this._asrReady = false;
    this._llama = null; // { child, port, key, args, ready }
    this._fehler = false;
    this._beenden = false;
    this._absturzZeiten = { worker: [], llama: [] };
    this._abstuerze = 0;
    this._fallback = false;
    this._timer = new Set();
    this._offen = new Map(); // id -> { resolve, reject, timer }
    this._seq = 0;
    this._stopNr = 0; // zählt stop()-Aufrufe, damit ein laufendes start() sie bemerkt
    this._fehlerArt = null; // 'worker' | 'llama': was zuletzt endgültig ausgefallen ist
    this._aufraeumVerzoegerungMs = aufraeumVerzoegerungMs || 0; // nur Tests
    this._llamaLauf = 0; // Zähler gegen überholte llama-Starts
    this._warter = new Set(); // wartende _warteAufEnde()
    this._gewuenscht = tier; // zuletzt über setTier angeforderte Stufe
  }

  get status() {
    return this._status;
  }
  get llamaUrl() {
    return this.tier === 'gruendlich' && this._llama
      ? `http://127.0.0.1:${this._llama.port}`
      : null;
  }
  get llamaKey() {
    return this.tier === 'gruendlich' && this._llama ? this._llama.key : null;
  }
  get llamaArgs() {
    return this._llama ? this._llama.args : null;
  }
  // Wie oft eine Komponente seit dem Anlegen abgestürzt ist.
  get abstuerze() {
    return this._abstuerze;
  }
  // true, wenn llama von Vulkan auf den Prozessor zurückgefallen ist.
  get fallback() {
    return this._fallback;
  }

  _setStatus(neu) {
    if (neu === this._status) return;
    this._status = neu;
    this.emit('status', neu);
  }

  _aktualisieren() {
    let neu = 'startet';
    if (this._fehler) neu = 'fehler';
    else if (!this._beenden && this._asrReady && (this.tier !== 'gruendlich' || this._llama?.ready))
      neu = 'bereit';
    this._setStatus(neu);
  }

  _spaeter(ms, fn) {
    const t = setTimeout(() => {
      this._timer.delete(t);
      fn();
    }, ms);
    this._timer.add(t);
    return t;
  }

  // Wartet, bis der Status nicht mehr 'startet' ist. stop() lässt sie mit Fehler enden,
  // eine neuere Stufenumschaltung (abbrechen()) lässt sie still enden.
  // `tier`: nur setTier-Warter tragen eine Stufe und können von einer anderen Stufe überholt werden;
  // der Warter von start() hat keine und endet erst bei finalem Status.
  _warteAufEnde(tier = null) {
    return new Promise((resolve, reject) => {
      const warter = { tier };
      const fertig = (fehler) => {
        this.off('status', pruefen);
        this._warter.delete(warter);
        if (fehler) reject(fehler);
        else resolve();
      };
      const pruefen = () => {
        if (this._status !== 'startet') fertig();
      };
      warter.abbrechen = () => fertig();
      warter.stoppen = () => fertig(new Error('Die Engines wurden gestoppt.'));
      this._warter.add(warter);
      this.on('status', pruefen);
      pruefen();
    });
  }

  // --- Start und Stopp -----------------------------------------------------

  async start() {
    const stopNr = this._stopNr;
    this._beenden = false;
    this._fehler = false;
    this._absturzZeiten = { worker: [], llama: [] };
    await this._verwaisteBeenden();
    // stop() während des Aufräumens: nichts mehr starten.
    if (stopNr !== this._stopNr) throw new Error('Die Engines wurden gestoppt.');
    this._setStatus('startet');
    this._workerStarten();
    if (this.tier === 'gruendlich') this._llamaStarten();
    await this._warteAufEnde();
    if (this._status === 'fehler') throw new Error('Die Engines konnten nicht gestartet werden.');
  }

  async stop() {
    this._stopNr += 1;
    this._beenden = true;
    for (const w of [...this._warter]) w.stoppen();
    for (const t of this._timer) clearTimeout(t);
    this._timer.clear();
    for (const [, o] of this._offen) {
      clearTimeout(o.timer);
      o.reject(new Error('Spracherkennung wurde beendet.'));
    }
    this._offen.clear();
    await Promise.all([this._workerBeenden(), this._llamaBeenden()]);
    this._asrReady = false;
    this._setStatus('startet');
  }

  // Der letzte Aufruf gewinnt: ältere, noch wartende Umschaltungen enden sofort.
  async setTier(tier) {
    this._gewuenscht = tier;
    for (const w of [...this._warter]) if (w.tier && w.tier !== tier) w.abbrechen();
    if (tier === this.tier) return;
    if (tier === 'gruendlich') {
      if (this._prepare) await this._prepare({ backend: this.backend, tier });
      if (this._gewuenscht !== tier || this._beenden) return; // inzwischen überholt
      this.tier = tier;
      this._fehler = false;
      this._absturzZeiten.llama = [];
      this._aktualisieren();
      this._llamaStarten();
      await this._warteAufEnde(tier);
      if (this._gewuenscht !== tier) return;
      if (this._status === 'fehler')
        throw new Error('Der llama-server konnte nicht gestartet werden.');
    } else {
      this.tier = tier;
      await this._llamaBeenden();
      // Ein endgültig ausgefallener llama-server zählt ohne gründliche Stufe nicht mehr.
      if (this._fehlerArt === 'llama') this._fehler = false;
      this._aktualisieren();
    }
  }

  // --- Absturzbehandlung -----------------------------------------------------

  _abgestuerzt(art) {
    if (this._beenden) return;
    this._abstuerze += 1;
    const jetzt = Date.now();
    const liste = (this._absturzZeiten[art] = this._absturzZeiten[art].filter(
      (t) => jetzt - t < ABSTURZ_FENSTER_MS,
    ));
    liste.push(jetzt);
    if (liste.length >= MAX_ABSTUERZE) {
      if (art === 'llama' && this.backend === 'vulkan') {
        console.error('llama-server stürzt auf Vulkan ab, Rückfall auf den Prozessor.');
        this.backend = 'cpu';
        this._fallback = true;
        liste.length = 0;
      } else {
        console.error(`${art} ist ${MAX_ABSTUERZE}-mal abgestürzt, gebe auf.`);
        this._fehler = true;
        this._fehlerArt = art;
        this._aktualisieren();
        return;
      }
    }
    this._aktualisieren();
    const nr = Math.max(1, Math.min(liste.length, this._verzoegerungen.length));
    const wartezeit = this._verzoegerungen[nr - 1];
    this._spaeter(wartezeit, () => {
      if (art === 'worker') this._workerStarten();
      else if (this.tier === 'gruendlich') this._llamaStarten();
    });
  }

  // --- ASR-Worker -------------------------------------------------------------

  _workerStarten() {
    const { utilityProcess } = require('electron');
    const skript = this._fake
      ? path.join(FAKES, 'fake-asr-worker.js')
      : path.join(__dirname, '..', 'asr', 'worker.js');
    const w = utilityProcess.fork(skript, [], {
      env: { ...process.env },
      serviceName: 'Letterflow Spracherkennung',
    });
    this._worker = w;
    this._asrReady = false;
    const wache = this._spaeter(BEREIT_TIMEOUT_MS, () => {
      console.error('Spracherkennung wurde nicht rechtzeitig bereit.');
      w.kill();
    });
    w.on('message', (m) => {
      if (w !== this._worker) return;
      if (m.type === 'ready') {
        clearTimeout(wache);
        this._asrReady = true;
        this._aktualisieren();
      } else if (m.type === 'result') {
        this._abschliessen(m.id, null, m.text);
      } else if (m.type === 'error') {
        if (m.id !== undefined) this._abschliessen(m.id, new Error(m.message));
        else {
          console.error('Spracherkennung konnte nicht geladen werden:', m.message);
          w.kill();
        }
      }
    });
    w.once('exit', () => {
      clearTimeout(wache);
      this._timer.delete(wache);
      if (w !== this._worker) return;
      this._worker = null;
      this._asrReady = false;
      for (const id of [...this._offen.keys()])
        this._abschliessen(id, new Error('Spracherkennung wurde unerwartet beendet.'));
      this._abgestuerzt('worker');
    });
    w.postMessage({
      type: 'init',
      modelDir: path.join(this.dataDir, 'models', PARAKEET_ORDNER),
      numThreads: this.threads,
    });
  }

  async _workerBeenden() {
    const w = this._worker;
    this._worker = null;
    if (!w) return;
    const ende = new Promise((r) => w.once('exit', r));
    w.kill();
    await Promise.race([ende, pause(BEENDEN_TIMEOUT_MS)]);
  }

  _abschliessen(id, fehler, text) {
    const o = this._offen.get(id);
    if (!o) return;
    this._offen.delete(id);
    clearTimeout(o.timer);
    if (fehler) o.reject(fehler);
    else o.resolve(text);
  }

  transcribe(samples) {
    if (!this._worker || !this._asrReady)
      return Promise.reject(new Error('Die Spracherkennung ist nicht bereit.'));
    const id = ++this._seq;
    const w = this._worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._abschliessen(id, new Error('Zeitüberschreitung bei der Spracherkennung.'));
        w.kill(); // hängt vermutlich: neu starten, sonst staut sich alles dahinter
      }, this._transcribeTimeoutMs);
      this._offen.set(id, { resolve, reject, timer });
      w.postMessage({ type: 'transcribe', id, samples });
    });
  }

  // --- llama-server -----------------------------------------------------------

  _llamaExe() {
    return this.backend === 'cuda'
      ? path.join(this.dataDir, 'engines', 'cuda', 'llama', LLAMA_EXE)
      : path.join(bundledEnginesDir(), this.backend, 'llama', LLAMA_EXE);
  }

  async _llamaStarten() {
    const lauf = ++this._llamaLauf;
    let port;
    try {
      port = await freierPort();
    } catch (e) {
      console.error('Kein freier Port:', e);
      return this._abgestuerzt('llama');
    }
    // Wurde inzwischen beendet oder umgeschaltet (_llamaBeenden zählt den Lauf hoch), nichts starten.
    if (lauf !== this._llamaLauf || this._beenden || this.tier !== 'gruendlich' || this._llama)
      return;
    const key = crypto.randomBytes(24).toString('hex');
    const modell = MODELS.find((m) => m.id === 'llama-gruendlich');
    const args = [
      '-m',
      path.join(this.dataDir, 'models', ...modell.file.split('/')),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-t',
      String(physischeKerne()),
      '-c',
      '4096',
      '--api-key',
      key,
    ];
    if (this.backend !== 'cpu') args.push('-ngl', '99');

    let exe = this._llamaExe();
    let vollArgs = args;
    const env = { ...process.env };
    if (this._fake) {
      exe = process.execPath;
      vollArgs = [path.join(FAKES, 'fake-llama.js'), ...args];
      env.ELECTRON_RUN_AS_NODE = '1';
    }
    let logFd = 'ignore';
    try {
      fs.mkdirSync(path.join(this.dataDir, 'logs'), { recursive: true });
      logFd = fs.openSync(path.join(this.dataDir, 'logs', 'llama-server.log'), 'w');
    } catch {}
    const child = spawn(exe, vollArgs, {
      cwd: this._fake ? undefined : path.dirname(exe),
      env,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    });
    if (typeof logFd === 'number') fs.closeSync(logFd);
    // Das Starten dauert einen Moment; wurde währenddessen beendet oder umgeschaltet, wieder abräumen.
    if (lauf !== this._llamaLauf || this._beenden || this.tier !== 'gruendlich') {
      child.kill();
      return;
    }
    const llama = { child, port, key, args, ready: false, absichtlich: false };
    this._llama = llama;
    if (child.pid) this._pidSchreiben(child.pid);

    let beendet = false;
    const wache = this._spaeter(BEREIT_TIMEOUT_MS, () => {
      console.error('llama-server wurde nicht rechtzeitig bereit.');
      child.kill();
    });
    const ende = () => {
      if (beendet) return;
      beendet = true;
      clearTimeout(wache);
      this._timer.delete(wache);
      this._pidEntfernen(child.pid);
      if (this._llama === llama) this._llama = null;
      if (!llama.absichtlich) this._abgestuerzt('llama');
    };
    child.once('exit', ende);
    child.once('error', (e) => {
      console.error('llama-server nicht gestartet:', e.message);
      ende();
    });

    // Bereit = GET /health liefert 200.
    while (!beendet && !llama.ready) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (r.status === 200) {
          // Aufwärmen: die erste Anfrage verarbeitet den Systemprompt und dauert sonst mehrere Sekunden.
          await this._llamaAufwaermen(port, key);
          if (!beendet) {
            llama.ready = true;
            clearTimeout(wache);
            this._aktualisieren();
          }
          break;
        }
      } catch {}
      await pause(HEALTH_INTERVALL_MS);
    }
  }

  // Eine winzige Anfrage vor „bereit“; ein Fehler hier verhindert den Start nicht.
  async _llamaAufwaermen(port, key) {
    try {
      await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hallo' }],
          max_tokens: 1,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
    } catch (e) {
      console.error('Aufwärmen von llama-server fehlgeschlagen:', e.message);
    }
  }

  async _llamaBeenden() {
    this._llamaLauf += 1;
    const llama = this._llama;
    this._llama = null;
    if (!llama) return;
    llama.absichtlich = true;
    const { child } = llama;
    if (child.exitCode === null && child.signalCode === null) {
      const ende = new Promise((r) => child.once('exit', r));
      child.kill();
      const rest = await Promise.race([ende.then(() => true), pause(BEENDEN_TIMEOUT_MS)]);
      if (rest !== true) await this._prozessBeenden(child.pid);
    }
    this._pidEntfernen(child.pid);
  }

  // --- PID-Datei und verwaiste Prozesse -----------------------------------------

  get _pidDatei() {
    return path.join(this.dataDir, 'engines.pid');
  }
  _pidListe() {
    try {
      return fs
        .readFileSync(this._pidDatei, 'utf8')
        .split(/\r?\n/)
        .map((z) => Number(z.trim()))
        .filter((p) => Number.isInteger(p) && p > 0);
    } catch {
      return [];
    }
  }
  _pidListeSchreiben(liste) {
    try {
      if (liste.length) fs.writeFileSync(this._pidDatei, liste.join(String.fromCharCode(10)));
      else fs.rmSync(this._pidDatei, { force: true });
    } catch (e) {
      console.error('PID-Datei nicht geschrieben:', e.message);
    }
  }
  _pidSchreiben(pid) {
    this._pidListeSchreiben([...new Set([...this._pidListe(), pid])]);
  }
  // Entfernt nur den Eintrag des beendeten Prozesses, nie die ganze Datei.
  _pidEntfernen(pid) {
    this._pidListeSchreiben(this._pidListe().filter((p) => p !== pid));
  }

  async _prozessName(pid) {
    try {
      const { stdout } = await promisify(execFile)(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true },
      );
      const m = /^"([^"]+)"/.exec(stdout.trim());
      return m ? m[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  async _prozessBeenden(pid) {
    try {
      await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
      });
    } catch {}
  }

  // Beendet in engines.pid gelistete, noch laufende llama-server-Prozesse einer früheren Sitzung.
  async _verwaisteBeenden() {
    const liste = this._pidListe();
    if (this._aufraeumVerzoegerungMs) await pause(this._aufraeumVerzoegerungMs);
    // Im Test läuft der Ersatz-llama unter dem Namen der Electron-Datei.
    const erwartet = this._fake ? path.basename(process.execPath).toLowerCase() : LLAMA_EXE;
    for (const pid of liste) {
      if (pid !== process.pid && (await this._prozessName(pid)) === erwartet)
        await this._prozessBeenden(pid);
      this._pidEntfernen(pid);
    }
  }
}
module.exports = { EngineManager };
