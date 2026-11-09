; DinePOS Kitchen installer additions (electron-builder nsis.include).

!macro customUnInstall
  ; "Open when Windows starts" (app.setLoginItemSettings) is a Run entry for this user. A real uninstall removes it, or it
  ; is left pointing at a deleted program. An upgrade (the old version's uninstaller runs with --updated) keeps it.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.DinePOS Kitchen"
  ${endIf}
!macroend
