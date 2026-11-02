; DinePOS installer additions (electron-builder NSIS `include`).
;
; "Install as master" (docs/01): this PC runs the outlet server as a Windows service. The service starts at boot,
; restarts on failure and keeps its database in %ProgramData%\DinePOS. Billing terminals install the same
; package with the option unticked; they only run the desktop app.
;
; Unattended: DinePOS-Setup.exe /S /MASTER=1 (or /MASTER=0). An upgrade keeps the previous choice.
; Uninstalling removes the service and the firewall rule but NEVER deletes %ProgramData%\DinePOS (bills).

!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!define DINEPOS_SERVICE_EXE "$INSTDIR\resources\server\DinePOS-Server.exe"
!define DINEPOS_FIREWALL_RULE "DinePOS Server"
!define DINEPOS_REG_KEY "Software\DinePOS"

!ifndef BUILD_UNINSTALLER
  Var DinePosMaster
  Var DinePosMasterCheckbox

  !macro customInit
    ; Default: the previous choice on upgrade, otherwise master (most outlets start with one PC).
    StrCpy $DinePosMaster "1"
    ReadRegStr $0 HKLM "${DINEPOS_REG_KEY}" "Master"
    ${If} $0 == "0"
      StrCpy $DinePosMaster "0"
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
    ${NSD_CreateCheckbox} 0 40u 100% 14u "Install as master: run the DinePOS outlet server on this PC"
    Pop $DinePosMasterCheckbox
    ${If} $DinePosMaster == "1"
      ${NSD_Check} $DinePosMasterCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 0 62u 100% 48u "The server runs as a Windows service, starts when the PC starts and stores data in %ProgramData%\DinePOS. Port 7420 is opened on private networks only. Untick this on billing terminals; there, enter the master PC's address in DinePOS Settings."
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
  FunctionEnd

  !macro customInstall
    ${If} $DinePosMaster == "1"
      DetailPrint "Setting up this PC as the DinePOS master…"
      SetShellVarContext all
      CreateDirectory "$APPDATA\DinePOS"
      CreateDirectory "$APPDATA\DinePOS\logs"
      ; A previous service (repair install) is replaced cleanly.
      nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" stop'
      Pop $0
      nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" uninstall'
      Pop $0
      nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" install'
      Pop $0
      ${If} $0 != "0"
        MessageBox MB_ICONEXCLAMATION|MB_OK "The DinePOS server could not be registered as a Windows service (code $0). Run the installer again as an administrator." /SD IDOK
      ${Else}
        nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" start'
        Pop $0
        ${If} $0 != "0"
          MessageBox MB_ICONEXCLAMATION|MB_OK "The DinePOS server was installed but did not start (code $0). See the logs in $APPDATA\DinePOS\logs." /SD IDOK
        ${EndIf}
      ${EndIf}
      nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${DINEPOS_FIREWALL_RULE}"'
      Pop $0
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${DINEPOS_FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=7420 profile=private,domain'
      Pop $0
      WriteRegStr HKLM "${DINEPOS_REG_KEY}" "Master" "1"
    ${Else}
      WriteRegStr HKLM "${DINEPOS_REG_KEY}" "Master" "0"
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ; Stop and remove the service if this PC was a master (harmless otherwise).
  ${If} ${FileExists} "${DINEPOS_SERVICE_EXE}"
    nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" stop'
    Pop $0
    nsExec::ExecToLog '"${DINEPOS_SERVICE_EXE}" uninstall'
    Pop $0
  ${EndIf}
  ${IfNot} ${isUpdated}
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${DINEPOS_FIREWALL_RULE}"'
    Pop $0
  ${EndIf}
  ; %ProgramData%\DinePOS (database, backups, logs) is intentionally kept.
!macroend
