# Letterflow – Design

Stand: 2026-11-08 · Urheber: Julius Steiner

## Absicht und Warum

Letterflow ist eine Windows-Diktier-App wie Wispr Flow, aber **komplett lokal und kostenlos**. STRG+WIN gedrückt halten, sprechen, loslassen – der Text erscheint geglättet und fehlerfrei im aktiven Eingabefeld. Deutsch und Englisch werden oft gemischt („Ich schick dir das Meeting-Recap später“).

Warum: Gute Diktier-Programme stecken hinter einer Paywall oder schicken Audio in die Cloud. Letterflow soll an deren Qualität herankommen, ohne Konto, ohne API-Schlüssel, ohne laufende Kosten, und an Freunde (Windows) weitergegeben werden können.

## Ziele

- Gedrückt-halten-Diktat mit STRG+WIN in jedem Programm.
- Geglätteter Text: Satzzeichen, Groß-/Kleinschreibung, Füllwörter („ähm“, „äh“, „also halt“) entfernt, Selbstkorrekturen angewendet („Montag, nein, Dienstag“ → „Dienstag“), Aufzählungen bei Bedarf als Liste.
- Deutsch/Englisch-Mix bleibt erhalten – englische Wörter werden nicht übersetzt.
- Hardware wird bestmöglich genutzt: NVIDIA (CUDA), sonst jede Grafikkarte über Vulkan, sonst Prozessor. Automatisch erkannt.
- Warnung, wenn gesprochen wurde, aber kein Textfeld aktiv ist; der Text liegt dann in der Zwischenablage.
- Eigenes Wörterbuch für Namen und Fachbegriffe.
- Weitergebbar: Installer, kurze Anleitung (LIESMICH); neue Versionen verteilt Julius selbst.

## Nicht-Ziele (vorerst)

- NPU-Unterstützung (späterer Ausbau; fertige Whisper-Pfade gibt es derzeit nur für Snapdragon, der Entwickler-Laptop hat keine NPU).
- Cloud-Modus, Konten, Synchronisation.
- Andere Betriebssysteme als Windows 10/11 x64.
- Sprachbefehle („mach das förmlicher“), Umschalt-Modus statt Gedrückthalten, Verlauf aller Diktate.
- Andere Sprachen als Deutsch/Englisch gezielt optimieren (Whisper kann sie, wird aber nicht darauf abgestimmt).

## Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)

- Text landet im falschen Fenster oder geht verloren.
- Das Sprachmodell „antwortet“ auf das Diktat oder führt es aus, statt es nur zu glätten (z. B. Diktat „Schreib mir eine E-Mail an Tom“ muss genau so eingefügt werden).
- Das Startmenü springt beim Loslassen von STRG+WIN auf.
- Die App bremst den PC spürbar, wenn nicht diktiert wird.
- Englische Begriffe werden eingedeutscht oder übersetzt.
- Flackern, schwarze Fenster, Systemdialoge statt eigener Meldungen.

## Rahmenbedingungen

- Alles auf Deutsch (Oberfläche, Meldungen, Doku, Commits) – siehe `CLAUDE.md.txt`.
- Electron-App mit `package.json`; Version bei jeder Änderung erhöhen; Auto-Release über `.github/workflows/auto-release.yml`.
- Playwright-Tests für neue Funktionen; `npm test` vor dem Push; Prettier (`npm run format`).
- Fenstergrößen 900–1700 px prüfen (Einstellungsfenster).
- Eigene Dialoge im App-Stil, weiche Animationen, Akzentfarbe.
- LICENSE und Über-Dialog: Julius Steiner, alle Rechte beim Entwickler. Drittanbieter-Lizenzen (whisper.cpp, llama.cpp, Modelle) im Über-Dialog bzw. in einer Hinweisdatei.
- Kein Netzwerkverkehr außer dem Modell-Download.
- Entwicklungsrechner: Ryzen 7 7730U (Radeon Vega iGPU), 15 GB RAM, keine NPU. Node.js, Python und `gh` sind dort noch nicht installiert.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Electron-Oberfläche + whisper.cpp und llama.cpp als **eigene Server-Prozesse** (`whisper-server`, `llama-server`) auf localhost | Absturz einer Engine reißt die App nicht mit, Engine-Binaries je Hardware austauschbar (CUDA/Vulkan/CPU), Modelle bleiben geladen. Etwas mehr Prozessverwaltung. |
| B | Electron mit eingebauten Node-Addons (node-llama-cpp, Whisper-Addon) | Weniger Teile, aber ein Absturz beendet die ganze App; Whisper-Addons für Node sind weniger ausgereift. |
| C | Tauri/Rust (wie das Open-Source-Projekt Handy) | Schlanker, aber passt nicht zum vorgegebenen Ablauf (npm, Electron, Playwright). |

Verworfen: Python + faster-whisper – keine AMD-GPU-Unterstützung. Gewählt hat Julius **A**. Nach der Messung (2026-11-08) läuft die Spracherkennung statt über `whisper-server` über sherpa-onnx (Parakeet) in einem eigenen Prozess; das Prinzip „Engines als eigene Prozesse“ bleibt.

## Entschiedener Aufbau

### Ablauf eines Diktats

1. **Taste gedrückt** (STRG+WIN; im Modus „Umschalten“: zweimal schnell getippt, höchstens 400 ms zwischen den Druckanfängen; ein einzelnes Antippen tut nichts, Tippen dazwischen verwirft es): Aufnahme startet sofort, kleine Aufnahme-Anzeige erscheint (Pegel-Animation). Beim Drücken merkt sich die App das aktive Fenster und prüft, ob ein Textfeld fokussiert ist.
2. **Während des Sprechens**: Audio wird an Sprechpausen in Abschnitte geteilt; fertige Abschnitte werden schon im Hintergrund erkannt, damit beim Loslassen nur noch der letzte Rest fehlt.
3. **Taste losgelassen** (Modus „Umschalten“: ein neuer Druck der Sprechtaste; Esc bricht in beiden Modi ab): letzter Abschnitt wird erkannt, Gesamttext geht an die Glättung.
4. **Glättung** – je nach Stufe per Regeln oder durch das lokale Sprachmodell. Hängt das Sprachmodell länger als ein Zeitlimit oder schlägt fehl, wird der regelbasiert geglättete Text verwendet – nie geht Text verloren.
5. **Einfügen**: Zwischenablage sichern → Text setzen → STRG+V senden → alte Zwischenablage wiederherstellen. Nur wenn das Fenster von Schritt 1 noch aktiv ist.
6. **Kein Textfeld / Fenster gewechselt**: Text bleibt in der Zwischenablage, die Anzeige zeigt eine Warnung im App-Stil („Kein Textfeld aktiv – Text liegt in der Zwischenablage“).
7. Zu kurze Aufnahmen (versehentliches Drücken) oder Stille werden verworfen, ohne etwas einzufügen.

### Spracherkennung (geändert nach Messung, Julius' Entscheidung 2026-11-08)

- **NVIDIA Parakeet TDT 0.6B v3** (int8, ONNX) über **sherpa-onnx** (`sherpa-onnx-node`) auf dem Prozessor, in einem eigenen Prozess. Gemessen auf dem Entwickler-Laptop: 0,27 s für 3,6 s Audio, 0,68 s für 11,9 s Audio; Whisper large-v3-turbo brauchte dort 12–34 s. Qualität auf TTS-Testsätzen etwa gleichauf (siehe `docs/messungen.md` Abschnitt 9).
- Keine Sprachvorgabe nötig, englische Wörter bleiben Englisch, Satzzeichen und Großschreibung liefert das Modell (nicht immer zuverlässig – die Glättung rundet ab).
- Audio wird an Sprechpausen geteilt, höchstens 20 s je Abschnitt (Empfehlung der Model Card).
- Whisper entfällt. Fällt Parakeet beim Testsatz mit echter Stimme durch, wird mit Julius über Whisper als Ersatz gesprochen.

### Glättung (Julius' Entscheidung: „Automatisch“)

- **Stufe „Schnell“** – feste Regeln, kein Sprachmodell, ca. 1 s Gesamtzeit: Füllwörter („ähm“, „äh“, „öhm“, „hm“, „uh“, „um“ …) raus, Wörterbuch-Schreibweisen, Leerzeichen/Satzzeichen bereinigen, Satzanfang groß, Satzende-Zeichen. Selbstkorrekturen („Montag, nein, Dienstag“) werden hier **nicht** angewendet.
- **Stufe „Gründlich“** – llama.cpp `llama-server` mit **Qwen3-4B-Instruct-2507** (Q4_K_M, Apache 2.0). Fester System-Prompt: nur umschreiben, nie antworten; Füllwörter raus, Selbstkorrekturen anwenden, Satzzeichen, Sprachmix behalten, Wörterbuch-Schreibweisen einhalten, keine Inhalte hinzufügen. Diktat wird klar als Daten markiert. Fallback bei Zeitüberschreitung/Fehler: Stufe „Schnell“.
- **Stufe „Ausgewogen“** (0.24, Julius: „Gründlich“ legt den Laptop lahm, „Schnell“ ist etwas schwach) – derselbe `llama-server`-Weg mit **Qwen3-1.7B** (Q4_K_M, Apache 2.0, Denkmodus aus über `enable_thinking: false`), gleicher Prompt und gleiche Wächter, Rückfall auf die Regeln. Schonend: immer nur Prozessor (kein `-ngl`), halbe physische Kerne (mind. 2), Kontext 2048, Prozesspriorität „niedriger als normal“ (`--prio -1`), einmal geladen und warm gehalten. Gemessen auf dem Entwickler-Laptop (nur Prozessor): WER 12,5 % statt 13,8 % bei „Schnell“, nie schlechter als „Schnell“, Glättung im Median 0,9 s, bereit nach 2,7 s (`docs/messungen.md`). Ein Wächter entfernt stehengebliebene Füllwörter aus jeder Modellausgabe.
- **„Automatisch“** (Standard): „Gründlich“ auf PCs mit NVIDIA-Grafikkarte oder einer Grafikkarte mit ≥ 6 GB eigenem Grafikspeicher; sonst „Ausgewogen“ bei ≥ 8 GB Arbeitsspeicher (gemessen ≥ 7 GiB, weil Windows Grafikspeicher abzieht) und ≥ 4 Kernen (≥ 8 Threads); sonst „Schnell“. In den Einstellungen jederzeit fest auf eine Stufe stellbar; gespeicherte Stufen bleiben. Die Erstwahl beim ersten Start bietet alle drei an, die passende ist vorgewählt („empfohlen“).
- Glättung in den Einstellungen abschaltbar (dann der unveränderte Parakeet-Text).

### Hardware

- Spracherkennung läuft immer auf dem Prozessor (schnell genug, keine GPU-Builds nötig).
- Für die Glättung „Gründlich“: NVIDIA vorhanden → CUDA-Build von llama.cpp; sonst Vulkan-Build; Selbsttest schlägt fehl → CPU-Build. Ergebnis wird angezeigt (Einstellungen: „Läuft auf: Grafikkarte (Vulkan)“).
- Das Glättungsmodell wird nur geladen (und nur heruntergeladen), wenn „Ausgewogen“ (1,1 GB) oder „Gründlich“ (2,5 GB) aktiv ist; ein Wechsel zwischen beiden tauscht das Modell.
- Modelle bleiben geladen, solange die App läuft (sofortige Reaktion). Leerlauf ohne Rechenlast.

### Oberfläche

- **Taskleisten-Symbol** (Infobereich) mit Menü: Einstellungen, Über Letterflow, Beenden. Kein Hauptfenster.
- **Aufnahme-Anzeige**: kleine Pille unten mittig, über allen Fenstern, nimmt keinen Fokus. Zustände: Aufnahme (Pegel), Verarbeitung, Warnung, Fehler. Weiche Ein-/Ausblendung. Das Fenster ist nur beim Diktieren gezeigt (0.25). **Vollbild** (Spiel, Video, Präsentation; exklusives Direct3D-Vollbild, Präsentationsmodus oder ein Vordergrundfenster ohne Titelleiste, das seinen Bildschirm ganz deckt): keine Pille und keine Bildschirmerfassung, Aufnahme und Einfügen laufen normal.
- **Mikrofon** (0.25): im nativen Helfer über WASAPI (geteilter Modus, ereignisgesteuert, Windows wandelt in 16 kHz mono). Audio fließt nur zwischen Drücken und Loslassen. Nach einem Diktat bleibt das Gerät 15 s geöffnet, aber gestoppt (kein Ton, kein Mikrofon-Symbol von Windows): Start dann ~3 ms statt ~0,2 s. Gerätewahl über den Gerätenamen (Windows-Standard oder ein benanntes Gerät).
- **Programmsymbol** (0.25): Der Helfer meldet jeden Vordergrundwechsel (`SetWinEventHook`), die App lädt das Symbol vorab; die Pille zeigt es ab dem ersten Bild. Lädt es noch, ein neutraler Platzhalter; Programm unbekannt/ohne eigenes Symbol oder kein Textfeld: Letterflow-Symbol.
- **Einstellungsfenster**: Mikrofon, Glättung an/aus, Wörterbuch (Liste), Mit Windows starten, Hardware-Anzeige, Modellstatus.
- **Erster Start**: Willkommen + Modell-Download mit Fortschritt (ca. 0,7 GB, mit „Gründlich“ ca. 3,2 GB), Wiederaufnahme nach Abbruch, Prüfsummen-Kontrolle. Ablage unter `%LOCALAPPDATA%\Letterflow\models`.

### Weitergabe

- **Privates GitHub-Repo, kein Auto-Update** (Julius' Entscheidung). Der Auto-Release-Workflow baut weiterhin bei jeder neuen Version den Installer (electron-builder, NSIS) als Release im privaten Repo; Julius lädt ihn dort herunter und gibt ihn selbst an Freunde weiter. Kein electron-updater.
- Installer ist **unsigniert**: Windows zeigt beim Installieren eine SmartScreen-Warnung – die LIESMICH erklärt „Weitere Informationen → Trotzdem ausführen“.
- Versionsnummer im Über-Dialog sichtbar, damit Freunde sehen, ob sie aktuell sind.
- LIESMICH.md mit Kurzanleitung für Freunde.

## Qualität und Messung

- **Testsatz**: ~20 kurze eingesprochene WAV-Aufnahmen (DE, EN, Mix, mit „ähm“ und Selbstkorrekturen) mit erwartetem Text. Dient zur Modellwahl und als Regressionsprüfung.
- **Tempo-Ziel**: unter 2 s vom Loslassen bis zum eingefügten Text bei 10 s Diktat – mit Stufe „Schnell“ auf dem Entwickler-Laptop, mit „Gründlich“ auf PCs, die automatisch „Gründlich“ bekommen.
- Playwright-Tests für Einstellungsfenster, Aufnahme-Anzeige-Zustände, Warnung, Erststart-Download (mit Test-Modelldatei).
- Pipeline-Tests mit WAV-Fixtures gegen die echten Engines (nicht in jeder CI nötig, aber lokal vor Release).

## Festlegungen nach Builder-Check (Claudes Entscheidungen, korrigierbar)

- **Keine Admin-Rechte.** Letterflow läuft ohne Erhöhung. Ist das Zielfenster ein Admin-Programm (Windows blockiert dann Tastatureingaben), gilt es wie „kein Textfeld“: Warnung + Text in der Zwischenablage.
- **Textfeld-Erkennung nachsichtig.** Warnung nur, wenn sicher kein Eingabefeld aktiv ist (z. B. Desktop, Taskleiste, Admin-Fenster) oder das Fenster gewechselt wurde. Ist das Ergebnis unklar (Chromium-/Electron-Apps, Word, Terminal), wird eingefügt. Grund: Ein unnötiger Hinweis bei einem gültigen Feld nervt bei jedem Diktat; STRG+V ins Leere richtet keinen Schaden an.
- **Glättungs-Fallback** ist eine Rettung, nicht der Normalfall: Bei Zeitüberschreitung des Sprachmodells greift die Regel-Glättung.
- **Speicher:** Modelle bleiben geladen (keine Wartezeit beim nächsten Diktat). Maximale Diktatlänge 5 Minuten, danach stoppt die Aufnahme mit Hinweis.
- **Modelle nur mit freier Lizenz** (Apache 2.0 / MIT / CC BY 4.0), z. B. Qwen3 (Apache 2.0), Parakeet (CC BY 4.0 – Namensnennung von NVIDIA im Über-Dialog und in `DRITTANBIETER.md`) – kein Gemma wegen seiner Nutzungsbedingungen. Download von Hugging Face, feste Adressen und SHA-256-Prüfsummen in der App.
- **Tastenkürzel änderbar** in den Einstellungen (Standard STRG+WIN), falls das Startmenü sich auf einem PC nicht zuverlässig unterdrücken lässt.
- **Testsatz:** Julius spricht die ~20 Sätze ein; der Plan enthält dafür ein kleines Aufnahme-Skript mit den vorgegebenen Sätzen.
- **Sprache:** Plan, Doku, Oberfläche und Code-Kommentare auf Deutsch; Bezeichner im Code Englisch.

## Dem Builder überlassen

- Wie Tastatur-Hook, Startmenü-Unterdrückung, Fokus-/Textfeld-Erkennung (Windows UI Automation) und STRG+V-Senden technisch umgesetzt werden (Node-Addon, FFI oder kleiner nativer Helfer) – Hauptsache schnell (< 50 ms) und stabil.
- Woher die Engine-Binaries kommen (offizielle Releases oder eigener CI-Build) und wie sie gebündelt werden.
- Methode der Abschnittsbildung an Sprechpausen (eigene Pegelerkennung oder Silero-VAD von sherpa-onnx).
- Genaue Zeitlimits, Ports (zufällig, nur 127.0.0.1), Modell-Quantisierung.
- Aussehen im Detail innerhalb der Vorgaben (Akzentfarbe, weiche Animationen, App-Stil).
