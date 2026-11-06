; DinePOS installer additions (electron-builder NSIS `include`).
;
; "Install as master" (docs/01): this PC runs the DinePOS outlet server, a standalone local process like the
; order hub: the "DinePOS Server" shortcut opens it in its own window (bundled node.exe + server.mjs, production
; settings, data in %ProgramData%\DinePOS). "Start with Windows" adds the shortcut to the all-users Startup folder,
; so it starts when someone signs in. Billing terminals install the same package with "master" unticked.
;
; Unattended: DinePOS-Setup.exe /S /MASTER=1 /AUTOSTART=1 (or 0). An upgrade keeps the previous choices.
; Uninstalling stops a running server and removes shortcuts and the firewall rule but NEVER deletes
; %ProgramData%\DinePOS (bills).

!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!define DINEPOS_SERVER_DIR "$INSTDIR\resources\server"
!define DINEPOS_SERVER_LNK "DinePOS Server.lnk"
!define DINEPOS_FIREWALL_RULE "DinePOS Server"
!define DINEPOS_REG_KEY "Software\DinePOS"
; Stops the server started from this installation only (build/server/stop-server.ps1 matches its node.exe path).
!define DINEPOS_STOP_SERVER 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${DINEPOS_SERVER_DIR}\stop-server.ps1"'

!ifndef BUILD_UNINSTALLER
  Var DinePosMaster
  Var DinePosAutostart
  Var DinePosMasterCheckbox
  Var DinePosAutostartCheckbox

  !macro customInit
    ; Defaults: the previous choices on upgrade, otherwise master + start with Windows.
    StrCpy $DinePosMaster "1"
    StrCpy $DinePosAutostart "1"
    ReadRegStr $0 HKLM "${DINEPOS_REG_KEY}" "Master"
    ${If} $0 == "0"
      StrCpy $DinePosMaster "0"
    ${EndIf}
    ReadRegStr $0 HKLM "${DINEPOS_REG_KEY}" "Autostart"
    ${If} $0 == "0"
      StrCpy $DinePosAutostart "0"
    ${EndIf}
    ${GetParameters} $1
    ClearErrors
    ${GetOptions} $1 "/MASTER=" $2
    ${IfNot} ${Errors}
      ${If} $2 == "1"
        StrCpy $DinePosMaster "1"
      ${Else}
        StrCpy $DinePosMaster "0"
      ${EndIf}
    ${EndIf}
    ClearErrors
    ${GetOptions} $1 "/AUTOSTART=" $2
    ${IfNot} ${Errors}
      ${If} $2 == "1"
        StrCpy $DinePosAutostart "1"
      ${Else}
        StrCpy $DinePosAutostart "0"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom DinePosMasterPage DinePosMasterPageLeave
  !macroend

  Function DinePosMasterPage
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 30u "One PC in the restaurant is the master. It keeps the bills database and every billing terminal, captain phone and kitchen screen connects to it."
    Pop $0
    ${NSD_CreateCheckbox} 0 38u 100% 14u "Install as master: run the DinePOS Server on this PC"
    Pop $DinePosMasterCheckbox
    ${If} $DinePosMaster == "1"
      ${NSD_Check} $DinePosMasterCheckbox
    ${EndIf}
    ${NSD_CreateCheckbox} 12u 56u -12u 14u "Start the DinePOS Server when Windows starts (someone signs in)"
    Pop $DinePosAutostartCheckbox
    ${If} $DinePosAutostart == "1"
      ${NSD_Check} $DinePosAutostartCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 0 78u 100% 48u "The server runs in its own window (keep it open while the restaurant works) and stores data in %ProgramData%\DinePOS. Port 7420 (TCP and UDP) is opened on private networks only. Untick 'master' on billing terminals; there, enter the master PC's address in DinePOS Settings."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function DinePosMasterPageLeave
    ${NSD_GetState} $DinePosMasterCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $DinePosMaster "1"
    ${Else}
      StrCpy $DinePosMaster "0"
    ${EndIf}
    ${NSD_GetState} $DinePosAutostartCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $DinePosAutostart "1"
    ${Else}
      StrCpy $DinePosAutostart "0"
    ${EndIf}
  FunctionEnd

  !macro customInstall
    SetShellVarContext all
    ${If} $DinePosMaster == "1"
      DetailPrint "Setting up this PC as the DinePOS master…"
      CreateDirectory "$APPDATA\DinePOS"
      CreateDirectory "$APPDATA\DinePOS\logs"
      ; The server runs as whoever is signed in: every local user may write the data folder (S-1-5-32-545 = Users).
      nsExec::ExecToLog 'icacls "$APPDATA\DinePOS" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
      Pop $0
      CreateShortCut "$SMPROGRAMS\${DINEPOS_SERVER_LNK}" "${DINEPOS_SERVER_DIR}\node.exe" '"${DINEPOS_SERVER_DIR}\server.mjs"' "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Run the DinePOS outlet server"
      CreateShortCut "$DESKTOP\${DINEPOS_SERVER_LNK}" "${DINEPOS_SERVER_DIR}\node.exe" '"${DINEPOS_SERVER_DIR}\server.mjs"' "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Run the DinePOS outlet server"
      ${If} $DinePosAutostart == "1"
        CreateShortCut "$SMSTARTUP\${DINEPOS_SERVER_LNK}" "${DINEPOS_SERVER_DIR}\node.exe" '"${DINEPOS_SERVER_DIR}\server.mjs"' "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWMINIMIZED "" "Run the DinePOS outlet server"
      ${Else}
        Delete "$SMSTARTUP\${DINEPOS_SERVER_LNK}"
      ${EndIf}
      nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${DINEPOS_FIREWALL_RULE}"'
      Pop $0
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${DINEPOS_FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=7420 profile=private,domain'
      Pop $0
      ; P2-15: kitchen screens find the server by UDP on the same port number (same rule name, so uninstall removes both)
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${DINEPOS_FIREWALL_RULE}" dir=in action=allow protocol=UDP localport=7420 profile=private,domain'
      Pop $0
      WriteRegStr HKLM "${DINEPOS_REG_KEY}" "Master" "1"
      WriteRegStr HKLM "${DINEPOS_REG_KEY}" "Autostart" "$DinePosAutostart"
      ; Start it now as the signed-in user (not as the elevated installer), so the desktop app finds it at once.
      ${StdUtils.ExecShellAsUser} $0 "$SMPROGRAMS\${DINEPOS_SERVER_LNK}" "open" ""
    ${Else}
      Delete "$SMPROGRAMS\${DINEPOS_SERVER_LNK}"
      Delete "$DESKTOP\${DINEPOS_SERVER_LNK}"
      Delete "$SMSTARTUP\${DINEPOS_SERVER_LNK}"
      WriteRegStr HKLM "${DINEPOS_REG_KEY}" "Master" "0"
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ; Files cannot be replaced or removed while the server runs from them.
  nsExec::ExecToLog ${DINEPOS_STOP_SERVER}
  Pop $0
  SetShellVarContext all
  ${IfNot} ${isUpdated}
    Delete "$SMPROGRAMS\${DINEPOS_SERVER_LNK}"
    Delete "$DESKTOP\${DINEPOS_SERVER_LNK}"
    Delete "$SMSTARTUP\${DINEPOS_SERVER_LNK}"
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${DINEPOS_FIREWALL_RULE}"'
    Pop $0
  ${EndIf}
  ; %ProgramData%\DinePOS (database, backups, logs) is intentionally kept.
!macroend
