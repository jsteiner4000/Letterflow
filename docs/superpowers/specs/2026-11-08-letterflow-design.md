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

Verworfen: Python + faster-whisper – keine AMD-GPU-Unterstützung. Gewählt hat Julius **A**.

## Entschiedener Aufbau

### Ablauf eines Diktats

1. **Taste gedrückt** (STRG+WIN): Aufnahme startet sofort, kleine Aufnahme-Anzeige erscheint (Pegel-Animation). Beim Drücken merkt sich die App das aktive Fenster und prüft, ob ein Textfeld fokussiert ist.
2. **Während des Sprechens**: Audio wird an Sprechpausen in Abschnitte geteilt; fertige Abschnitte werden schon im Hintergrund erkannt, damit beim Loslassen nur noch der letzte Rest fehlt.
3. **Taste losgelassen**: letzter Abschnitt wird erkannt, Gesamttext geht an die Glättung.
4. **Glättung** durch das lokale Sprachmodell. Hängt sie länger als ein Zeitlimit oder schlägt fehl, wird der ungeglättete Whisper-Text verwendet – nie geht Text verloren.
5. **Einfügen**: Zwischenablage sichern → Text setzen → STRG+V senden → alte Zwischenablage wiederherstellen. Nur wenn das Fenster von Schritt 1 noch aktiv ist.
6. **Kein Textfeld / Fenster gewechselt**: Text bleibt in der Zwischenablage, die Anzeige zeigt eine Warnung im App-Stil („Kein Textfeld aktiv – Text liegt in der Zwischenablage“).
7. Zu kurze Aufnahmen (versehentliches Drücken) oder Stille werden verworfen, ohne etwas einzufügen.

### Spracherkennung

- whisper.cpp, Modell **large-v3-turbo** (quantisiert), als dauerhaft laufender `whisper-server`.
- Startprompt (initial prompt) mit einem gemischten DE/EN-Beispielsatz und den Wörterbuch-Einträgen, damit Schreibweisen und Sprachmix stimmen.
- Sprachvorgabe (fest „de“ vs. automatische Erkennung) wird anhand des Testsatzes (s. Qualität) entschieden – Ziel: Englisch bleibt Englisch.

### Glättung

- llama.cpp `llama-server`, kleines Instruct-Modell mit gutem Deutsch (Kandidaten: Qwen3 4B, Gemma 3 4B, Q4-quantisiert; für schwache PCs eine ~1,7B-Variante). Auswahl per Messung auf dem Testsatz.
- Fester System-Prompt: nur umschreiben, nie antworten; Füllwörter raus, Selbstkorrekturen anwenden, Satzzeichen, Sprachmix behalten, Wörterbuch-Schreibweisen einhalten, keine Inhalte hinzufügen. Diktat wird klar als Daten markiert.
- Glättung in den Einstellungen abschaltbar (dann nur Whisper-Text).

### Hardware

- Beim Start: NVIDIA vorhanden → CUDA-Build; sonst Vulkan-Build; Selbsttest schlägt fehl → CPU-Build. Ergebnis wird angezeigt (Einstellungen: „Läuft auf: Grafikkarte (Vulkan)“).
- CPU-Threads = physische Kerne.
- **Modellgröße für die Glättung nach Hardware-Stufe** (Julius' Entscheidung): Starke Hardware (z. B. NVIDIA-GPU oder viel VRAM) wird voll genutzt und bekommt das größere, klügere Glättungsmodell (4B oder größer). Verfehlt ein PC das Tempo-Ziel, nimmt er das kleinere (~1,7B). Die Spracherkennung bleibt überall large-v3-turbo.
- Modelle bleiben geladen, solange die App läuft (sofortige Reaktion). Leerlauf ohne Rechenlast.

### Oberfläche

- **Taskleisten-Symbol** (Infobereich) mit Menü: Einstellungen, Über Letterflow, Beenden. Kein Hauptfenster.
- **Aufnahme-Anzeige**: kleine Pille unten mittig, über allen Fenstern, nimmt keinen Fokus. Zustände: Aufnahme (Pegel), Verarbeitung, Warnung, Fehler. Weiche Ein-/Ausblendung.
- **Einstellungsfenster**: Mikrofon, Glättung an/aus, Wörterbuch (Liste), Mit Windows starten, Hardware-Anzeige, Modellstatus.
- **Erster Start**: Willkommen + Modell-Download mit Fortschritt (~3 GB), Wiederaufnahme nach Abbruch, Prüfsummen-Kontrolle. Ablage unter `%LOCALAPPDATA%\Letterflow\models`.

### Weitergabe

- **Privates GitHub-Repo, kein Auto-Update** (Julius' Entscheidung). Der Auto-Release-Workflow baut weiterhin bei jeder neuen Version den Installer (electron-builder, NSIS) als Release im privaten Repo; Julius lädt ihn dort herunter und gibt ihn selbst an Freunde weiter. Kein electron-updater.
- Installer ist **unsigniert**: Windows zeigt beim Installieren eine SmartScreen-Warnung – die LIESMICH erklärt „Weitere Informationen → Trotzdem ausführen“.
- Versionsnummer im Über-Dialog sichtbar, damit Freunde sehen, ob sie aktuell sind.
- LIESMICH.md mit Kurzanleitung für Freunde.

## Qualität und Messung

- **Testsatz**: ~20 kurze eingesprochene WAV-Aufnahmen (DE, EN, Mix, mit „ähm“ und Selbstkorrekturen) mit erwartetem Text. Dient zur Modellwahl und als Regressionsprüfung.
- **Messung auf dem Entwickler-Laptop** vor der Modellfestlegung: Zeit vom Loslassen bis zum eingefügten Text (Ziel: unter 2 s bei 10 s Diktat mit Glättung; Messung entscheidet, ob ein kleineres Modell nötig ist).
- Playwright-Tests für Einstellungsfenster, Aufnahme-Anzeige-Zustände, Warnung, Erststart-Download (mit Test-Modelldatei).
- Pipeline-Tests mit WAV-Fixtures gegen die echten Engines (nicht in jeder CI nötig, aber lokal vor Release).

## Festlegungen nach Builder-Check (Claudes Entscheidungen, korrigierbar)

- **Keine Admin-Rechte.** Letterflow läuft ohne Erhöhung. Ist das Zielfenster ein Admin-Programm (Windows blockiert dann Tastatureingaben), gilt es wie „kein Textfeld“: Warnung + Text in der Zwischenablage.
- **Textfeld-Erkennung nachsichtig.** Warnung nur, wenn sicher kein Eingabefeld aktiv ist (z. B. Desktop, Taskleiste, Admin-Fenster) oder das Fenster gewechselt wurde. Ist das Ergebnis unklar (Chromium-/Electron-Apps, Word, Terminal), wird eingefügt. Grund: Ein unnötiger Hinweis bei einem gültigen Feld nervt bei jedem Diktat; STRG+V ins Leere richtet keinen Schaden an.
- **Glättungs-Fallback** ist eine Rettung, nicht der Normalfall. Ist ein PC so langsam, dass das Zeitlimit regelmäßig greift, wählt die App ein kleineres Glättungsmodell.
- **Speicher:** Modelle bleiben geladen (keine Wartezeit beim nächsten Diktat). Maximale Diktatlänge 5 Minuten, danach stoppt die Aufnahme mit Hinweis.
- **Modelle nur mit freier Lizenz** (Apache 2.0 / MIT), z. B. Qwen3, Whisper – kein Gemma wegen seiner Nutzungsbedingungen. Download von Hugging Face, feste Adressen und SHA-256-Prüfsummen in der App.
- **Tastenkürzel änderbar** in den Einstellungen (Standard STRG+WIN), falls das Startmenü sich auf einem PC nicht zuverlässig unterdrücken lässt.
- **Testsatz:** Julius spricht die ~20 Sätze ein; der Plan enthält dafür ein kleines Aufnahme-Skript mit den vorgegebenen Sätzen.
- **Sprache:** Plan, Doku, Oberfläche und Code-Kommentare auf Deutsch; Bezeichner im Code Englisch.

## Dem Builder überlassen

- Wie Tastatur-Hook, Startmenü-Unterdrückung, Fokus-/Textfeld-Erkennung (Windows UI Automation) und STRG+V-Senden technisch umgesetzt werden (Node-Addon, FFI oder kleiner nativer Helfer) – Hauptsache schnell (< 50 ms) und stabil.
- Woher die Engine-Binaries kommen (offizielle Releases oder eigener CI-Build) und wie sie gebündelt werden.
- Methode der Abschnittsbildung an Sprechpausen (eigene Pegelerkennung oder Silero-VAD von whisper.cpp).
- Genaue Zeitlimits, Ports (zufällig, nur 127.0.0.1), Modell-Quantisierung.
- Aussehen im Detail innerhalb der Vorgaben (Akzentfarbe, weiche Animationen, App-Stil).
