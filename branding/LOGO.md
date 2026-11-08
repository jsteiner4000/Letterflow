# Letterflow – Logo und Verwendung

Stand: 2026-11-08 · Urheber: Julius Steiner

## Idee

Ein handgeschriebenes **l** fließt in eine gerade Grundlinie: Aus gesprochener Sprache wird sauberer Text.
„Letter“ und „Flow“ in einem einzigen Strich. Bewusst ohne Mikrofon, Sprechblase oder Schallbalken.

## Dateien

| Datei | Wofür |
|---|---|
| `symbol.svg` | Zeichen, ab 24 px |
| `symbol-klein.svg` | Kleinversion (kräftiger, offenere Schleife), unter 24 px |
| `wortmarke.svg` | Schriftzug „letterflow“ (eigene Buchstaben, keine Schrift nötig) |
| `lockup-horizontal.svg` | Zeichen + Schriftzug nebeneinander (Standard) |
| `lockup-gestapelt.svg` | Zeichen über Schriftzug (quadratische Flächen) |
| `export/windows/letterflow.ico` | App-Symbol für Electron/Installer (16–256 px) |
| `export/windows/tray-hell.ico` | Taskleisten-Symbol, weiß – für dunkle Taskleiste |
| `export/windows/tray-dunkel.ico` | Taskleisten-Symbol, dunkel – für helle Taskleiste |
| `export/symbol/`, `export/lockups/` | Schwarz, Weiß, Petrol als SVG + PNG |
| `praesentation.html`, `praesentation/` | Präsentationstafel mit Mockups |
| `konzepte/` | Die drei Ausgangskonzepte |

Die drei `.ico`-Dateien und `icon.png` (256 px) liegen als Kopie in `assets/` – von dort nutzt sie die App.
Tray-Symbol in Electron nach Systemfarbe wählen: `nativeTheme.shouldUseDarkColors ? 'tray-hell.ico' : 'tray-dunkel.ico'`
und bei `nativeTheme.on('updated')` neu setzen.

## Farben

| Name | HEX | RGB | Einsatz |
|---|---|---|---|
| Petrol | `#0F766E` | 15 118 110 | Zeichen, Akzentfarbe der App, Knöpfe (weiße Schrift: Kontrast 5,5:1) |
| Petrol hell | `#3CC4AE` | 60 196 174 | Zeichen/Akzent auf dunklem Grund |
| Tinte | `#1B2430` | 27 36 48 | Schriftzug, Text |
| Weiß | `#FFFFFF` | 255 255 255 | Zeichen auf Petrol oder dunklem Grund |

Einfarbig (schwarz oder weiß) funktioniert das Logo immer.

## Schutzzone und Mindestgrößen

- **Schutzzone:** rundum mindestens die Höhe des „o“ im Schriftzug frei lassen (beim Zeichen allein: ¼ seiner Breite).
- **Zeichen:** ab 24 px `symbol.svg`, darunter `symbol-klein.svg`.
- **Horizontales Lockup:** mindestens 120 px breit.

## Bitte nicht

- Zeichen verzerren, drehen oder spiegeln.
- Petrol auf dunklem Grund (zu wenig Kontrast) – dort Weiß oder Petrol hell.
- Schatten, Verläufe, Umrisse hinzufügen.
- Schriftzug in einer anderen Schrift setzen oder groß schreiben („LETTERFLOW“).
- Zeichen und Schriftzug neu anordnen oder Abstände ändern.

## Offene Punkte

- Die Master sind **strichbasiert** (abgerundete Linien). Für Druck, Plotter oder Stick die Striche einmal in
  Flächen umwandeln (Inkscape: Pfad → Kontur in Pfad umwandeln).
- **Markenrecherche** (DPMA/EUIPO, Bildersuche) vor der Weitergabe – nicht durchgeführt.
- Der Schriftzug ist klein geschrieben („letterflow“); im Fließtext und in der App heißt sie weiter „Letterflow“.
