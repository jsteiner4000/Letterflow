; Letterflow-Installer (von electron-builder automatisch eingebunden): immer für den aktuellen Benutzer,
; Frage nach der Desktop-Verknüpfung, Abschlussseite mit Hinweis zum Diktieren. Datei als UTF-8 mit BOM.

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1" ; keine Seite „Für wen installieren?“
!macroend

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var desktopKasten
  Var desktopWahl ; leer (= ja, auch bei stiller Installation) oder Zustand des Häkchens
  Var desktopHinweis

  !macro customPageAfterChangeDir
    Page custom VerknuepfungSeite VerknuepfungSeiteVerlassen

    Function VerknuepfungSeite
      !insertmacro MUI_HEADER_TEXT "Verknüpfungen" "Wo soll Letterflow zu finden sein?"
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateLabel} 0 0 100% 20u "Letterflow wird immer im Startmenü eingetragen."
      Pop $0
      ${NSD_CreateCheckbox} 0 26u 100% 12u "Zusätzlich eine Verknüpfung auf dem Desktop anlegen"
      Pop $desktopKasten
      ${If} $desktopWahl != ${BST_UNCHECKED}
        ${NSD_Check} $desktopKasten
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function VerknuepfungSeiteVerlassen
      ${NSD_GetState} $desktopKasten $desktopWahl
    FunctionEnd
  !macroend

  ; Ohne Häkchen wird nichts angelegt, eine vorhandene Verknüpfung aber auch nicht gelöscht.
  !macro customInstall
    ${If} $desktopWahl != ${BST_UNCHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      StrCpy $desktopHinweis " und auf dem Desktop"
    ${EndIf}
  !macroend

  !define MUI_FINISHPAGE_TITLE "Letterflow ist installiert"
  !define MUI_FINISHPAGE_TEXT "Letterflow ist jetzt im Startmenü$desktopHinweis zu finden und läuft im Infobereich der Taskleiste.$\r$\n$\r$\nHalte die rechte Strg-Taste gedrückt, um zu diktieren. Beim Loslassen wird der Text eingefügt.$\r$\n$\r$\nBeim ersten Start richtet Letterflow die Spracherkennung ein."
  !define MUI_FINISHPAGE_RUN_TEXT "Letterflow starten"
!endif

; Desktop-Verknüpfung nur beim echten Deinstallieren entfernen, nicht bei einem Update.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${endIf}
!macroend
