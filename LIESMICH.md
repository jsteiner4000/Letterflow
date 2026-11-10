# Letterflow

Diktieren auf Windows: Taste halten, sprechen, loslassen – der Text erscheint dort, wo du gerade schreibst. Alles läuft lokal auf deinem Rechner.

## Installieren

1. `Letterflow-Setup-<Version>.exe` ausführen. Es wird keine Administrator-Berechtigung gebraucht.
2. Windows zeigt eventuell eine blaue Warnung (SmartScreen), weil das Programm nicht signiert ist. Auf **Weitere Informationen** klicken, dann auf **Trotzdem ausführen**.
3. Der Installer fragt, ob zusätzlich zum Startmenü eine Verknüpfung auf dem Desktop angelegt werden soll (Häkchen, vorausgewählt).
4. Die Abschlussseite sagt, wo Letterflow zu finden ist; mit „Letterflow starten“ (vorausgewählt) geht es direkt los.

## Erster Start

Beim ersten Start lädt Letterflow einmalig die Sprachmodelle herunter (ca. 0,7 GB). Für die Glättung „Ausgewogen“ kommen ca. 1,1 GB dazu, für „Gründlich“ ca. 2,5 GB („Gründlich“ braucht eine Grafikkarte, NVIDIA oder ab 6 GB Grafikspeicher, sonst dauert jedes Diktat deutlich länger); vorher fragt Letterflow, welche Stufe du möchtest, und schlägt die zu deinem PC passende vor. Danach funktioniert alles ohne Internet.

## Benutzen

- **Rechte Strg** halten, sprechen, loslassen. Der Text wird eingefügt. In den Einstellungen kannst du stattdessen **Strg + Win** oder **Strg + Umschalt** wählen (Klick auf die Taste).
- Lieber ohne Festhalten? Unter „Bedienung“ auf **Umschalten** stellen: Sprechtaste **zweimal schnell tippen** startet, **einmal tippen** beendet und fügt ein. Ein einzelnes Antippen tut nichts.
- Mitten in einen vorhandenen Satz diktiert, setzt Letterflow keinen Schlusspunkt, ergänzt das Leerzeichen und schreibt Wörter wie „ich“, „und“, „der“ klein (wenn das Programm den Text um die Schreibmarke preisgibt).
- **Esc** während des Diktats verwirft die Aufnahme. Alles andere (etwa Alt + Tab zum Fensterwechsel) ist beim Diktieren erlaubt: Letterflow fügt den Text in das Fenster ein, in dem du angefangen hast, und bringt dich danach zurück.
- Das Symbol im Infobereich der Taskleiste zeigt den Zustand; ein Rechtsklick öffnet das Menü.

## Einstellungen

Über das Symbol im Infobereich öffnen. Dort stellst du Tastenkürzel, Mikrofon, Glättung („Schnell“, „Ausgewogen“ oder „Gründlich“; „Automatisch“ wählt nach deinem PC), Wörterbuch und den Start mit Windows ein. Unter „Pille“ passt du das Glas der Aufnahme-Anzeige an (Milchigkeit, Durchsicht, Lichtbrechung, Tönung). Unter „Text glätten“ steht, ob Grafikkarte oder Prozessor genutzt wird.

## Datenschutz

Für den Glaseffekt liest die Pille, solange sie sichtbar ist, den Bildschirmbereich direkt hinter sich – nur im Arbeitsspeicher, nie gespeichert oder gesendet (bei „Transparenzeffekte aus“ in Windows entfällt das).

Läuft ein Spiel, Video oder eine Präsentation im Vollbild, bleibt die Pille aus und der Bildschirm wird nicht gelesen; Diktieren und Einfügen funktionieren trotzdem. Das Mikrofon nimmt nur auf, solange du diktierst (nach einem Diktat bleibt es 15 Sekunden bereit, aber stumm, damit das nächste sofort startet).

## Hilfe bei Problemen

- **Kein Ton / Mikrofon nicht gefunden:** Windows-Einstellungen → Datenschutz & Sicherheit → Mikrofon: „Desktop-Apps den Zugriff erlauben“ einschalten.
- **Text erscheint nicht in einem Programm, das als Administrator läuft:** Windows lässt normale Programme dort nichts einfügen. Letterflow legt den Text dann in die Zwischenablage; mit Strg + V einfügen.
- **Virenscanner meldet etwas:** Letterflow beobachtet für die Tastenkombination die Tastatur (Tastatur-Hook), das lösen manche Virenscanner als Warnung aus. Die App ist nicht signiert; bei Bedarf eine Ausnahme für den Ordner `%LOCALAPPDATA%\Programs\Letterflow` anlegen.
- Das Protokoll (ohne diktierten Text) liegt in `%LOCALAPPDATA%\Letterflow\logs`.

## Neue Version

Letterflow aktualisiert sich selbst: Beim Start und alle vier Stunden sucht es nach einer neuen Version und lädt sie im Hintergrund (Windows meldet das kurz; unter Einstellungen → Allgemein siehst du den Fortschritt). Installiert wird beim nächsten Beenden oder sofort mit „Neu starten“. Deine Einstellungen und Modelle bleiben. Alternativ den neuen Installer von der Release-Seite einfach ausführen.

## Deinstallieren

Windows-Einstellungen → Apps → Letterflow → Deinstallieren. Einstellungen und Modelle bleiben in `%LOCALAPPDATA%\Letterflow`; diesen Ordner kannst du danach von Hand löschen.

## Lizenzen

Siehe `DRITTANBIETER.md` (auch im Über-Dialog der App).
