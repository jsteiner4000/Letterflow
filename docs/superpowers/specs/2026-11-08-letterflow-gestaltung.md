# Letterflow – Gestaltung (Redesign)

Stand: 2026-11-08 · Urheber: Julius Steiner · Ergänzt `2026-11-08-letterflow-design.md` (Funktion bleibt unverändert).

Entwürfe: `docs/design/` (`pille.png`, `pille-nah.png`, `pille-szenen.png`, `einstellungen-dunkel.png`, `einstellungen-hell.png`, dazu die HTML-Quellen `pille.html`, `einstellungen.html`). Bewertung: impeccable-Kritik vom 2026-11-08 (24/40), deren Punkte hier eingearbeitet sind.

## Gewählte Entwürfe (Julius, 2026-11-09) – verbindlich

- **App-Fenster:** `docs/design/einstellungen-hell.png` / `einstellungen-hell.html` ist die Vorlage (wirkt „nicht nach KI“). Der dunkle Modus nutzt dieselbe Vorlage mit den dunklen Tokens unten; die App folgt weiter Windows.
- **Pille:** `docs/design/pille-glas.png` / `pille-glas.html` ist die Vorlage: **leicht durchscheinendes Liquid-Glass** (heller Glanz oben links, Lichtkante, durchscheinender getönter Körper, Mint-Wellenform mit weichem Schein; Leuchtpunkt entfällt seit v4). Sie ersetzt die Glas-Werte von `pille.png`/`pille.html` (rauchiges Glas). Übernommen bleiben aus der Überarbeitung: alle Zustände und Texte, fester Platz rechts, Kürzen langer Namen, Ersatz-Symbol, Barrierefreiheit, immer dunkel.

## Absicht

Julius will eine **eigenständige Marke**: futuristisch, edel, schlicht, mit Glas-Look wie Apples „Liquid Glass“, der sich durch Pille, Taskleisten-Symbol und App zieht. Kein Effekt-Feuerwerk – **edles Glas statt Leuchten**. Leuchten ist ausschließlich Live-Zuständen vorbehalten (Pille beim Zuhören, Taskleisten-Symbol).

## Entscheidungen (Julius)

| Thema | Entscheidung |
|---|---|
| Richtung | Eigenständige Marke, Glas-Look |
| Pille, Durchsicht | Transparentes, getöntes Electron-Fenster (Variante B, auf dem Laptop getestet). Kein Windows-Acrylic (eckiger Kasten mit Rand). Kein echtes Weichzeichnen des Hintergrunds. |
| Pille, Farbe | **Immer dunkel** (liegt über fremden Programmen) |
| App, Hell/Dunkel | Einstellungen, Einrichtung, Über-Dialog und Taskleisten-Symbol **folgen Windows** |
| Glanz in der App | Ruhiges Glas mit Lichtkanten, **kein Glühen**, keine Verlaufs-Überschriften |
| Leuchten | Nur Live: Pille beim Zuhören (Wellenform), Taskleisten-Symbol „hört zu“ |
| Diktat-Ende | Loslassen beendet die Aufnahme und fügt ein (unverändert). Esc während des Haltens verwirft (bestehendes Verhalten), wird aber nicht prominent beworben. |

## Pille

Maße und Aufbau (siehe `docs/design/pille.html`, Klassen `.pill`):

- Höhe 44 px, Radius 22 px, max. Breite 340 px, Innenabstand links 12 px, rechts 14 px.
- **Glas (Vorlage `pille-glas.html`):** Körper `linear-gradient(180deg, rgba(255,255,255,.16), rgba(18,30,29,.42) 45%, rgba(6,14,13,.62))` – Hintergrund scheint leicht durch; Innenkanten `inset 0 1px 0 rgba(255,255,255,.55)`, `inset 0 -1px 0 rgba(255,255,255,.08)`, `inset 0 0 0 1px rgba(255,255,255,.14)`; Schatten `0 12px 32px rgba(0,0,0,.35)` + `0 0 0 .5px rgba(0,0,0,.4)`; Glanz `radial-gradient(120% 70% at 30% -20%, rgba(255,255,255,.45), transparent 55%)`; Schimmerstreifen `linear-gradient(105deg, transparent 30%, rgba(255,255,255,.22) 45%, transparent 60%)` **nur einmal beim Erscheinen** (läuft durch und verschwindet), sonst nicht sichtbar. Text mit `text-shadow: 0 1px 2px rgba(0,0,0,.35)` für Lesbarkeit über hellem Hintergrund. Wellenform Mint mit weichem Schein (`0 0 6px rgba(60,196,174,.7)`), Leuchtpunkt 8 px `#5EEAD4` rechts (Abstand 12 px) – beides nur in Live-Zuständen.
- **Links:** Symbol des Zielprogramms 20×20 px (Radius 5). Ohne Symbol: Petrol-Monogramm „ℓ“ (Verlauf `#14B8A6 → #0F766E`).
- **Text:** Abstand 10 px zum Symbol. Zeile 1 Programmname (Inter 600, 13 px, `#F4FBF9`), Zeile 2 Zustand (Inter 500, 12 px, `#C9DCD8`, volle Deckkraft). Lange Namen mit „…“ gekürzt.
- **Rechts:** fester Platz 76 px (Abstand 14 px), damit die Breite beim Zustandswechsel nicht springt: Wellenform (16 Balken à 2,5 px, Abstand 2 px, Mint-Verlauf `#D9FFF7 → #2DD4BF`, ohne Glow), Ladekreis oder Häkchen.
- Programmname kommt vom Windows-Helfer (Prozess-Datei → `FileDescription`, sonst Dateiname ohne `.exe`). Symbol per `app.getFileIcon(exePath, { size: 'small' })`. **Kein Fenstertitel** (Datenschutz).

Zustände und Texte (exakt):

| Zustand | Zeile 1 | Zeile 2 | Rechts | Kante |
|---|---|---|---|---|
| Zuhören | Programmname | „Ich höre zu …“ | Wellenform live | neutral |
| Aufbereiten | Programmname | „Text wird aufbereitet …“ | Ladekreis | neutral |
| Erfolg (0,7 s, dann wegschrumpfen) | „Eingefügt in {Programm}“ | „{n} Wörter“ (1 Wort: „1 Wort“) | Häkchen in Mint-Kreis | zart Mint |
| Kein Textfeld / Fenster gewechselt (4 s) | „Kein Textfeld aktiv“ bzw. „Fenster gewechselt“ | „Mit [Strg] [V] einfügen“ (Tasten als kleine Kappen) | – | zart Orange; links orangenes „!“-Symbol statt Programmsymbol |
| Fehler (z. B. Mikrofon) | bestehende Fehlertexte aus dem Diktat-Ablauf | – | – | zart Orange, „!“-Symbol |

Bewegung (Apple-Prinzipien, kritisch gedämpfte Federn, keine Überschwinger):
- Erscheinen: von 0,96 auf 1,0 skalieren + einblenden, ~220 ms, Ursprung unten Mitte; einmaliger, sehr dezenter Glanzstreifen über die Kante.
- Zustandswechsel: Inhalte überblenden (~150 ms), Breite gleitet weich.
- Verschwinden: auf 0,96 schrumpfen + ausblenden, ~160 ms (schneller als Erscheinen).
- `prefers-reduced-motion`: nur Überblenden, keine Skalierung, kein Glanzstreifen; Wellenform als ruhiger Pegelbalken.
- Windows „Transparenzeffekte“ aus (`prefers-reduced-transparency` bzw. Systemeinstellung): Glas voll deckend (`#151B1A`).
- Hoher Kontrast (`forced-colors`): Systemfarben, sichtbarer Rand.
- Bildschirmleser: Erfolg und Warnungen werden angesagt (Umsetzung dem Builder überlassen, z. B. Live-Region; da die Pille keinen Fokus nimmt, Wirkung mit der Windows-Sprachausgabe prüfen).

## Taskleisten-Symbol

Drei Zustände, je eine Variante für helle und dunkle Taskleiste (ICO, 16/20/24/32 px):
- **Bereit:** ruhiges Logo-Zeichen (bestehende `tray-hell.ico` / `tray-dunkel.ico`).
- **Hört zu:** Logo-Zeichen auf Mint/Petrol-Fläche – deutlich anders, auch bei 16 px (keine Verläufe/Glows, die bei 16 px verschwinden).
- **Hinweis/Fehler:** Logo-Zeichen auf Orange.
Tooltip passt sich an („Letterflow – bereit“, „… hört zu“, „… Hinweis“).

## App-Fenster (Einstellungen, Einrichtung, Über)

Tokens (`docs/design/einstellungen.html`, `:root` dunkel, `:root.light` hell) – als CSS-Variablen in `src/renderer/style.css`, **keine fest eingetragenen Farben in Komponenten**:

| Token | Dunkel | Hell |
|---|---|---|
| `--bg` | `#0A0E0E` + Petrol-Hauch oben rechts | `#F3F6F5` + Petrol-Hauch |
| `--surface` | `rgba(255,255,255,.045)` | `rgba(255,255,255,.78)` |
| `--surface-2` | `rgba(255,255,255,.07)` | `#FFFFFF` |
| `--edge-top` / `--edge` | `rgba(255,255,255,.16)` / `.07` | `#FFFFFF` / `rgba(11,31,29,.09)` |
| `--ink` / `--ink-2` | `#EDF6F4` / `#A9BDB9` | `#0B1F1D` / `#4A5F5B` |
| `--accent` / `--accent-ink` | `#3CC4AE` / `#04201C` | `#0F766E` / `#FFFFFF` |
| `--focus` | `#5EEAD4` | `#0F766E` |
| `--warm` | `#FDBA74` | `#C2410C` |

- Glasflächen = `--surface` + Lichtkante oben (`inset 0 1px 0 --edge-top`) + 1-px-Rand (`--edge`). Radius 12 px (Karten), 8 px (Bedienelemente).
- Schrift: **Outfit** (Überschriften, 600) und **Inter** (Text) – als Dateien mitgeliefert (SIL OFL, in `DRITTANBIETER.md`), nie aus dem Netz. Überschrift H1 22 px, Abschnitte 14 px, Text 12–13 px; Mindestgröße 11 px.
- Fokus: 2 px Rahmen in `--focus`, Abstand 2 px, auf allen Bedienelementen.
- Knöpfe/Karten: Hover hebt Fläche leicht an (Rand heller), Druck gibt nach (Skalierung 0,98, ~100 ms); ein dezenter Glanzstreifen beim Hover ist erlaubt, nie Dauerschleife.
- Kontrast: Text ≥ 4,5:1, Rahmen/Bedienelemente ≥ 3:1 (gewählte Stufe hat zusätzlich einen gefüllten Auswahlkreis).
- Fenster 880×600 (min. Breite bleibt bis 900 px prüfbar: Fenstergröße darf wachsen), Seitenleiste 200 px.

Aufbau Einstellungen (Seitenleiste mit **drei** Bereichen):
1. **Diktieren:** Tastenkürzel-Karte (Tasten als Kappen, „Gedrückt halten zum Diktieren“ / „Loslassen fügt den Text ein“, Knopf „Ändern“ öffnet die Auswahl der drei Tastenkürzel). Abschnitt „Text glätten“ mit Schalter im Kopf und Erklärung „Entfernt „ähm“, setzt Satzzeichen und deine Schreibweisen“; darunter drei Stufen-Kacheln mit Auswahlkreisen: Automatisch („Wählt nach deinem PC.“ + „Auf diesem PC: {Schnell|Gründlich}“), Schnell („Sofort, ohne Selbstkorrekturen.“), Gründlich („Wendet auch „Montag, nein, Dienstag“ an.“ + „Lädt einmalig 2,5 GB – fragt vorher“). Schalter aus → Kacheln blass und nicht wählbar. Abschnitt „Mikrofon“ mit Gerätewahl und kleiner Pegelanzeige.
2. **Wörterbuch:** bestehende Funktion im neuen Stil.
3. **Allgemein:** „Mit Windows starten“, Systemangaben (Spracherkennung, Glättung und wo sie läuft, Engine-Status), Version und Link zum Über-Dialog.
- Unten in der Seitenleiste: Status-Zeile („Bereit · alles lokal“, „Startet …“, „Einrichtung nicht abgeschlossen“, „Fehler – wird neu gestartet“).
- **Rückfrage vor „Gründlich“**, wenn das Modell noch fehlt: eigener App-Dialog „Gründliche Glättung laden? Einmalig 2,5 GB, danach offline.“ – „Laden“ / „Abbrechen“.

Einrichtungsfenster und Über-Dialog übernehmen Tokens, Glasflächen, Schriften und Fokus; Inhalte bleiben.

## Nicht-Ziele

- Kein echtes Weichzeichnen des Desktops hinter der Pille.
- Keine Dauer-Animationen, kein Glühen in der App, kein Violett.
- Keine neuen Funktionen außer: Programmname/-symbol in der Pille, Erfolgs-Zustand, Warnung mit Strg+V-Hinweis, Rückfrage vor 2,5 GB, Pegelanzeige.

## Dem Builder überlassen

- Technik der Bildschirmleser-Ansage für die nicht fokussierbare Pille.
- Genaue Federwerte innerhalb der genannten Zeiten.
- Erzeugung der zusätzlichen Taskleisten-ICOs aus dem bestehenden Logo (`branding/`).

## Aus einem Guss: Skalen (Apple-Design-Prüfung, 2026-11-08)

Alle Fenster und die Pille nutzen **nur** diese Werte (Entwurf `docs/design/einstellungen.html` ist darauf angeglichen; Pille bei der Umsetzung angleichen):

- **Schrift** (Inter mit `font-optical-sizing:auto`, Outfit nur für Überschriften und Wortmarke; Laufweite nach Größe, nie ein Einheitswert):
  | Rolle | Schrift | Größe/Zeilenhöhe | Laufweite |
  |---|---|---|---|
  | Seitentitel | Outfit 600 | 22/28 | −0,015em |
  | Wortmarke | Outfit 600 | 16/20 | −0,01em |
  | Abschnitt | Outfit 600 | 15/20 | −0,005em |
  | Text betont / Pillen-Name | Inter 600 | 13/18 | 0 |
  | Text | Inter 500 | 13/18 | 0 |
  | Zweitzeile / Pillen-Zustand / Hinweis | Inter 500 | 12/16 | 0 |
  | Kennzeichnung (z. B. „Auf diesem PC“) | Inter 600 | 11/14 | +0,02em |
  Über Glas (Pille): Gewicht nie unter 500, keine Deckkraft-Abschwächung.
- **Abstände:** nur 4 · 8 · 12 · 16 · 24 · 32 px (2 px nur innerhalb Wellenform/Pegel). Pille: links 12, rechts 16, Symbol→Text 8, Text→rechter Platz 16.
- **Radien (konzentrisch):** Pille 22 · Karten/Flächen 12 · Bedienelemente, Tasten-Kappen, Menüpunkte 8 · Logo 24 px → 6 · Programmsymbol 20 px → 5.
- **Farbrollen:** `--accent` (App: Auswahl, Schalter, Fokus) und `--live` `#5EEAD4` (nur Live: Wellenform, Erfolgshäkchen, Taskleisten-Symbol „hört zu“). Keine weiteren Mint-/Türkis-Töne.
- **Material:** Pille = schwerstes Material (dunkel getönt), Karten = leichtes Glas, Seitenleiste = Grundfläche ohne eigenes Glas. Nie helles Glas auf hellem Glas.
- **Bewegung:** kritisch gedämpfte Federn (Dämpfung 1,0, Reaktion 0,3–0,4 s), keine Überschwinger; Verschwinden schneller als Erscheinen; Erscheinen und Verschwinden auf demselben Weg (nach unten, 6 px + Skalierung 0,96). **Reaktion ohne Verzögerung:** Die Pille ist spätestens im nächsten Frame nach dem Tastendruck sichtbar; Knöpfe reagieren beim Drücken (`:active`), nicht erst beim Loslassen.

## Überarbeitung v3 (Julius, 2026-11-09) – ersetzt Abweichendes oben

Nach dem Praxistest. Verbindliche Vorlagen: `docs/design/einstellungen-v3.html` (+ `-hell.png`, `-dunkel.png`) und `docs/design/pille-v2.html` (+ `.png`).

**App-Fenster (Designsprache nach Julius' Referenz):**
- Warm-neutrale Farben, einfarbig: Seitenleiste `#F4F2EE`, Inhalt `#FFFFFF`, Gruppenflächen `#F6F4F0`, gewählter Menüpunkt `#EBE8E2`, Trennlinien `rgba(30,25,20,.08)`, Text `#1D1B18` / `#6B675F` / `#8E8A82`. Dunkel: `#1E1D1B` / `#252422` / `#2C2B28` / `#33322F`, Text `#EFECE6` / `#A39F97` / `#7F7B74` (alle Tokens in der Vorlage). **Kein Petrol in der Bedienung** – Schalter/Auswahlkreise schwarz (dunkel: hell); Petrol nur im Logo und in der Pille.
- Seitentitel in **Newsreader** (Serifen, 400, 30/36, −0,01em; SIL OFL, mitgeliefert); Text Inter. Outfit entfällt in den App-Fenstern.
- Seitenleiste: Abschnittsnamen „EINSTELLUNGEN“ (Diktieren, Wörterbuch, Allgemein) und „INFO“ (Über Letterflow) in 11 px Großbuchstaben; feine Liniensymbole; aktiver Punkt als gefülltes Feld; unten „Letterflow v{Version}“ mit Statuspunkt (grün bereit, grau startet, orange Einrichtung/Fehler; Text als Tooltip).
- Inhalt als **Listen-Gruppen** (Fläche, Radius 12, Zeilen 14/18 px Innenabstand, Trennlinien): Zeile = Titel (Inter 600 13,5) + Erklärtext (Inter 13, `--ink-2`) links, Bedienelement rechts. Glättungsstufen als Listenzeilen mit Auswahlkreis („Automatisch – Wählt nach deinem PC – hier: {Stufe}“, „Schnell“, „Gründlich – … · lädt einmalig 2,5 GB“). Schalter „Text glätten“ als erste Zeile der Gruppe „Glättung“. Mikrofon: Zeile „Eingabegerät“ mit „Pegel testen“ und Auswahl.
- Einrichtung, Über-Dialog und Rückfrage-Dialog in derselben Sprache.

**Sprechtaste:** Standard ist **Rechte Strg** (`hotkey: 'rctrl'`); Strg+Win und Strg+Umschalt bleiben wählbar. Gespeicherte Einstellungen bleiben unverändert.

**Pille v2:** nur Programmsymbol (kein Name), Höhe 52 px, Radius 26, Symbol 28 px scharf (`app.getFileIcon(exe, { size: 'large' })`, auf 28 × Bildschirmskalierung verkleinert), Wellenform 22 Balken à 3 px / Abstand 2,5 px, Höhe 30 px, empfindlicher (leise Stimme sichtbar; logarithmische Pegelkurve, schnelleres Ansprechen, sanfteres Abklingen), Leuchtpunkt rechts. Erfolg: Symbol + „Eingefügt“ / „{n} Wörter“ + Häkchen. Warnung/Fehler mit Text wie bisher. Glas wie `pille-glas.html`.
**Erscheinen „Liquid-Drop“:** Glastropfen (Kreis 52 px, Start-Skalierung ≈ 0,55) ploppt in ≈ 90 ms auf, dehnt sich in ≈ 110 ms zur vollen Breite mit minimalem Nachfedern (≈ 1,04), danach blenden Wellenform und Punkt ein (≈ 80 ms); gesamt < 0,3 s. Verschwinden rückwärts, schneller. Reduzierte Bewegung: nur Einblenden.

## Pille v3 – echtes Glas mit Lichtbrechung (Julius, 2026-11-09)

Vorlage: die Liquid-Glass-Navigationsleiste der YouTube-App (Bild von Julius). Ersetzt die Glas-Werte von Pille v2; Inhalt (nur Symbol, Wellenform, Zustände, Liquid-Drop) bleibt.

- **Klar wie echtes Glas:** kaum Tönung (dunkler Schleier nur so stark, dass Symbol und Wellenform lesbar bleiben), der Hintergrund ist deutlich zu sehen.
- **Lichtbrechung:** Was hinter der Pille liegt, wird wie durch eine dicke Glaslinse **verzogen** – zur Mitte leicht vergrößert, zum Rand hin stark gestaucht/gebogen (Linsen-Rand), leichte Unschärfe, minimale Farbsäume an der Kante.
- **Kante:** kräftige, aber feine Lichtkante (heller Glanz oben links und unten rechts, dunklere Innenkante unten), weicher Außenschatten.
- **Technik (Builder-Entscheidung mit Leitplanken):** Ein transparentes Fenster sieht den Desktop nicht. Deshalb: Pillen-Fenster mit `setContentProtection(true)` (erscheint nie in Bildschirmaufnahmen, auch nicht in der eigenen), beim Erscheinen den Bildschirmbereich unter der Pille per `desktopCapturer` erfassen und als verzerrten Hintergrund in der Pille zeichnen (WebGL- oder SVG-Verschiebungskarte), Auffrischung höchstens alle ~750 ms solange sichtbar. Die Pille erscheint sofort mit getöntem Glas; die Brechung blendet ein, sobald das Bild da ist (< 150 ms). Bilder bleiben nur im Speicher, werden nie gespeichert oder versendet. Fallback (Fehler, „Transparenz aus“, Fernwartung/RDP): getöntes Glas wie v2.
- **Leistung:** keine Daueraufnahme, kein spürbarer CPU-Verbrauch im Leerlauf; Erfassung nur während die Pille sichtbar ist.

### Pille v3 – Freigabe und Anpassbarkeit (Julius, 2026-11-09)

Vorlage verbindlich: `docs/design/pille-v3.html` (+ `pille-v3-foto.png`, `pille-v3-dokument.png`) – echte Linsenberechnung (Mitte ×1,07, starke Randbiegung auf 16 px, Farbsaum ±6 %), Standard **leicht milchig**: Hintergrund im Glas mit `blur(1.2px) saturate(1.15)`, darüber Milchschicht `linear-gradient(rgba(255,255,255,.26) → .14)` (über hellem Grund `.34 → .20`), Lichtkante oben links / Gegenreflex unten rechts, weicher Schatten. Wellenform passt sich an: weiß über dunklem/buntem, dunkel `#1d1d1f` über hellem Grund (mittlere Helligkeit des erfassten Ausschnitts).

**Einstellungen → neuer Bereich „Pille“** (Seitenleiste unter EINSTELLUNGEN, zwischen Diktieren und Wörterbuch) mit Live-Vorschau der Pille über einem Beispielhintergrund und diesen Reglern (Zeilen im v3-Listenstil):
- **Milchigkeit** 0–100 % (Standard 40 %) – Weichzeichnung + Milchschicht.
- **Durchsicht** 0–100 % (Standard 85 %) – 0 % = undurchsichtiges Glas.
- **Lichtbrechung** 0–100 % (Standard 60 %) – Stärke der Linse (0 = flaches Glas).
- **Tönung**: Hell (Standard), Neutral, Dunkel, Warm, Petrol – als runde Farbfelder mit Auswahlring + „Eigene Farbe“ (Farbwähler).
- Knopf „Zurücksetzen“.
Werte werden sofort gespeichert (`settings.pill = { frost, opacity, refraction, tint }`, validiert) und wirken ab dem nächsten Erscheinen der Pille. Barrierefreiheit: „Transparenz aus“ erzwingt Durchsicht 0.

### Pille v4 – flüssig, scharf, Zeitstrahl (Julius, 2026-11-09) – ersetzt Abweichendes oben

- **Kein Leuchtpunkt** mehr (Pille und Vorschau).
- **Aufploppen:** Fenster hat von Anfang an seine Endgröße und wird während der Aufnahme nicht verschoben. Liquid-Drop (< 0,3 s) animiert nur `transform`, `opacity` und `clip-path: inset(… round 26px)`; kein Layout, keine Größenänderung der Linse. Die Animation beginnt erst mit dem ersten Bild des sichtbaren Fensters. Bildschirmerfassung und Hochladen der Linse starten erst nach dem Aufploppen (bis dahin getöntes Glas, dann Überblenden). Kein Außenschatten (war bisher durch den Clip ohnehin unsichtbar).
- **„Animation beim Erscheinen“** (Bereich „Pille“): Automatisch (Standard) / An / Aus, `settings.pill.animation = 'auto' | 'an' | 'aus'`. Automatisch = aus ohne GPU-Compositing oder mit < 4 Kernen, und schaltet sich ab, wenn zwei Aufploppen hintereinander > 30 % der Bilder verwerfen (gemessen per `requestAnimationFrame`; gemerkt als `pill.animationAutoOff`, ändert nie ein ausdrückliches An/Aus). Aus und reduzierte Bewegung: schlichtes Einblenden 120 ms.
- **Scharfer Rand:** Linse in `devicePixelRatio` (exakte Gerätepixelgröße per ResizeObserver, neu bei Bildschirmwechsel), Kante der Linse über ~1 Gerätepixel weich, Form schneidet `border-radius` (`overflow: hidden`); Breite und Lage der Pille auf ganze Gerätepixel; Lichtkante genau 1 Gerätepixel ohne Weichzeichnung.
- **Wellenform als Zeitstrahl** (wie iOS-Sprachmemos): Stille = leere Fläche; beim Sprechen alle ~45 ms ein Balken rechts (Höhe = Pegel in diesem Moment), gleitet per `transform` nach links und blendet am linken Rand aus. Farbe weiterhin weiß bzw. `#1d1d1f` über hellem Grund. Reduzierte Bewegung: ruhiger waagrechter Pegelbalken.
- **Abdunkeln über hellem Grund:** ist der erfasste Bereich hell (> 0,6), dunkelt das Glas weich ab (300 ms). Einstellbar: Schalter „Auf hellem Hintergrund abdunkeln“ (Standard an) und „Stärke“ 0–100 % (Standard 50 %, aus = gesperrt), `pill.autoDarken`, `pill.autoDarkenStrength`. „Zurücksetzen“ setzt das Glas zurück, nicht die Animation.

**Sprechtaste (Diktieren):** als Tastenkappen – „Rechte Strg“ = Kappe „Strg“ mit kleinem „rechts“ daneben, sonst zwei Kappen mit dünnem „+“; Kanten 1 Gerätepixel; gleich in der „Ändern“-Liste.

### Pille v5 – Tropfen mit Linsen-Wobble, schärfer, ruhigerer Zeitstrahl (Julius, 2026-11-09) – ersetzt Abweichendes oben

- **Maße:** Pille 60 px hoch (Radius 30), Symbol 30 px, Wellenfläche 102 px (Gesamtbreite Aufnahme ≈ 178 statt 194 px). Fenster 420 × 152 DIP (ganze Gerätepixel bei 125 %); Lage und Breite der Pille auf ganze Gerätepixel, Lichtkante 1 Gerätepixel, Linsenkante über ~1 Pixel weich. Linse skaliert mit (Maße der 52-px-Vorlage × 60/52).
- **Zeitstrahl:** neuer Balken alle 90 ms (≈ 61 px/s, halb so schnell wie v4), symmetrisch um die Mitte, 3 → 34 px, Verstärkung so, dass normales Sprechen 60–90 % erreicht (`(pegel − 0,1) / 0,6`). Stille: 3-px-Punkte mit 35 % Deckkraft laufen mit. Farbe und Ausblenden links wie v4.
- **Erscheinen „Tropfen mit Linsen-Wobble“** (ersetzt Liquid-Drop, Einstellung Automatisch/An/Aus unverändert): je Eigenschaft eine gedämpfte Feder in `overlay.js` (echtes dt): Größe 0,5 → 1 (Antwort 0,26 s, ζ 0,7), Breite Kreis → Pille (0,32 s, ζ 0,65, Start +50 ms). Volumen bleibt (`scaleY = scaleX^−0,35`). Brechung 2,5× → 1× (Uniform) mit kurzem Wobble; Glanz und Rand folgen der Verformung und sind beim stärksten Wölben heller; Farbsaum wächst mit der Brechung; Schatten (neu, eigenes Element) klein und eng beim Tropfen, wächst und wird weicher beim Landen. Inhalt (Symbol, dann Welle) blendet bei ≈ 85 % mit 70 ms + 2 px Aufstieg ein. Gesamt ≤ 0,4 s. Nur transform, opacity, clip-path und Uniform; kein Fenster- oder Layoutwechsel.
- **Erfassung vorher:** Der Hauptprozess erfasst ab `show()` (und hält den letzten Streifen im Speicher, bei `prepare()` vorgewärmt); der Renderer wartet bis 120 ms auf den Hintergrund, sonst einfacher Tropfen ohne Wobble. Shader und Textur werden beim Laden im verborgenen Fenster aufgewärmt.
- **Verschwinden:** gespiegelt, kritisch gedämpft (ζ 1, 0,12 s), ≤ 0,18 s, kein Wobble. Aus und reduzierte Bewegung: Einblenden/Ausblenden 120 ms.

### Pille 0.23 – dezenterer Rand, Lieblingswerte (Julius, 2026-11-09) – ersetzt Abweichendes oben

- **Rand:** Der helle Ring wirkte künstlich. Jetzt wie Apple-Glas zurückhaltend: oben ein Lichtsaum (1 Gerätepixel, weiß 30 %, über hellem Grund 45 %), ringsum nur eine kaum sichtbare Kante (weiß 8 %, über hellem Grund schwarz 10 %), innen unten leichte Abdunklung (6 %); kein Gegenreflex unten rechts, kein innerer Schein. Glanz oben links halb so stark (18 %). Linse und Brechung unverändert. Vergleich: `docs/design/ist/rand-vorher-nachher.png`.
- **Standard der Pille:** Milchigkeit 25, Durchsicht 34, Lichtbrechung 62, Tönung dunkel, Abdunkeln an (50 %), Animation automatisch. Gespeicherte Werte bleiben.
- **Ersatz-Symbol:** Programm unbekannt, kein Textfeld oder Programm ohne eigenes Symbol (leeres Windows-Symbol) → Letterflow-Symbol (`assets/icon.png`) statt „ℓ“-Plakette.
