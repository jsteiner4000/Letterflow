# Letterflow

Diktieren auf Windows: Taste halten, sprechen, loslassen – der Text erscheint dort, wo du gerade schreibst. Alles läuft lokal auf deinem Rechner.

## Installieren

1. `Letterflow-Setup-<Version>.exe` ausführen. Es wird keine Administrator-Berechtigung gebraucht.
2. Windows zeigt eventuell eine blaue Warnung (SmartScreen), weil das Programm nicht signiert ist. Auf **Weitere Informationen** klicken, dann auf **Trotzdem ausführen**.
3. Danach startet Letterflow; Verknüpfungen auf dem Desktop und im Startmenü sind angelegt.

## Erster Start

Beim ersten Start lädt Letterflow einmalig die Sprachmodelle herunter (ca. 0,7 GB). Wenn du in den Einstellungen „Gründlich“ wählst, kommen noch ca. 2,5 GB dazu. Danach funktioniert alles ohne Internet.

## Benutzen

- **Strg + Win** halten, sprechen, loslassen. Der Text wird eingefügt.
- **Esc** während des Haltens verwirft die Aufnahme.
- Das Symbol im Infobereich der Taskleiste zeigt den Zustand; ein Rechtsklick öffnet das Menü.

## Einstellungen

Über das Symbol im Infobereich öffnen. Dort stellst du Tastenkürzel, Mikrofon, Glättung („Schnell“/„Gründlich“), Wörterbuch und den Start mit Windows ein. Unter „Text glätten“ steht, ob Grafikkarte oder Prozessor genutzt wird.

## Hilfe bei Problemen

- **Kein Ton / Mikrofon nicht gefunden:** Windows-Einstellungen → Datenschutz & Sicherheit → Mikrofon: „Desktop-Apps den Zugriff erlauben“ einschalten.
- **Text erscheint nicht in einem Programm, das als Administrator läuft:** Windows lässt normale Programme dort nichts einfügen. Letterflow legt den Text dann in die Zwischenablage; mit Strg + V einfügen.
- **Virenscanner meldet etwas:** Letterflow beobachtet für die Tastenkombination die Tastatur (Tastatur-Hook), das lösen manche Virenscanner als Warnung aus. Die App ist nicht signiert; bei Bedarf eine Ausnahme für den Ordner `%LOCALAPPDATA%\Programs\Letterflow` anlegen.
- Das Protokoll (ohne diktierten Text) liegt in `%LOCALAPPDATA%\Letterflow\logs`.

## Neue Version

Den neuen Installer einfach ausführen; er ersetzt die alte Version, deine Einstellungen und Modelle bleiben.

## Deinstallieren

Windows-Einstellungen → Apps → Letterflow → Deinstallieren. Einstellungen und Modelle bleiben in `%LOCALAPPDATA%\Letterflow`; diesen Ordner kannst du danach von Hand löschen.

## Lizenzen

Siehe `DRITTANBIETER.md` (auch im Über-Dialog der App).
