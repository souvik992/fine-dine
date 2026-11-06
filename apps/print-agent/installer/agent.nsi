; DinePOS Print Agent installer (P6-03). Built by scripts/installer.mjs (makensis from electron-builder's cache).
; Installs to Program Files, asks for the server address and the agent key (checked before going on), and runs the
; agent at Windows start as a scheduled task under SYSTEM (no one needs to log in; restarted if it stops).
; Defines passed in: VERSION, SRC (folder with node.exe and agent.mjs), OUTFILE.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"

!define NAME "DinePOS Print Agent"
!define TASK "DinePOS Print Agent"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DinePOS-PrintAgent"

Name "${NAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\DinePOS Print Agent"
BrandingText "DinePOS"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "DinePOS Print Agent"
!define MUI_WELCOMEPAGE_TEXT "Install this on a PC on the same network as the kitchen and bill printers. It prints DinePOS tickets for printers the DinePOS server cannot reach itself (a server in DinePOS Cloud, or on another network).$\r$\n$\r$\nFirst add the agent in DinePOS: Settings > Kitchen & printers > Add print agent. You need the key it shows."
!define MUI_FINISHPAGE_TITLE "The print agent is running"
!define MUI_FINISHPAGE_TEXT "It starts with Windows by itself. In DinePOS, choose this agent under $\"Printed by$\" on each printer it should print, then use Test print."
!insertmacro MUI_PAGE_WELCOME
Page custom ConfigPage ConfigLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${NAME} installer"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026"

Var Dialog
Var ServerBox
Var KeyBox
Var Server
Var Key

Function .onInit
  SetShellVarContext all
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext all
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
FunctionEnd

Function ConfigPage
  !insertmacro MUI_HEADER_TEXT "Connect to DinePOS" "Where the outlet server is, and this agent's key."
  nsDialogs::Create 1018
  Pop $Dialog
  ${NSD_CreateLabel} 0 0 100% 22u "Server address: the main PC's address on this network (for example 192.168.1.20), or the outlet's DinePOS Cloud address (https://...)."
  Pop $0
  ${NSD_CreateText} 0 24u 100% 13u "$Server"
  Pop $ServerBox
  ${NSD_CreateLabel} 0 46u 100% 22u "Print agent key: shown once in DinePOS when you added the agent (Settings > Kitchen & printers)."
  Pop $0
  ${NSD_CreateText} 0 70u 100% 13u "$Key"
  Pop $KeyBox
  nsDialogs::Show
FunctionEnd

; checks the address and the key with the agent itself (unpacked to a temporary folder), and saves them
Function ConfigLeave
  ${NSD_GetText} $ServerBox $Server
  ${NSD_GetText} $KeyBox $Key
  SetOutPath "$PLUGINSDIR\check"
  File "${SRC}\node.exe"
  File "${SRC}\agent.mjs"
  nsExec::ExecToStack '"$PLUGINSDIR\check\node.exe" "$PLUGINSDIR\check\agent.mjs" --setup "$Server" "$Key"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "$1"
    Abort
  ${EndIf}
FunctionEnd

Section "Print agent"
  ; an older agent stops first (its files are replaced)
  nsExec::Exec 'schtasks /End /TN "${TASK}"'
  Sleep 1000
  SetOutPath "$INSTDIR"
  File "${SRC}\node.exe"
  File "${SRC}\agent.mjs"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; the saved key: readable by SYSTEM and administrators only
  nsExec::Exec 'icacls "$APPDATA\DinePOS Print Agent\agent.json" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F'

  ; at Windows start, as SYSTEM, no time limit, restarted every minute if it stops
  FileOpen $2 "$PLUGINSDIR\task.xml" w
  FileWriteUTF16LE /BOM $2 '<?xml version="1.0" encoding="UTF-16"?>$\r$\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n'
  FileWriteUTF16LE $2 '<RegistrationInfo><Description>DinePOS Print Agent: prints DinePOS tickets on this network$\'s printers.</Description></RegistrationInfo>$\r$\n'
  FileWriteUTF16LE $2 '<Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>$\r$\n'
  FileWriteUTF16LE $2 '<Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>$\r$\n'
  FileWriteUTF16LE $2 '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden></Settings>$\r$\n'
  FileWriteUTF16LE $2 '<Actions Context="Author"><Exec><Command>"$INSTDIR\node.exe"</Command><Arguments>"$INSTDIR\agent.mjs"</Arguments><WorkingDirectory>$INSTDIR</WorkingDirectory></Exec></Actions>$\r$\n</Task>$\r$\n'
  FileClose $2
  nsExec::ExecToStack 'schtasks /Create /F /TN "${TASK}" /XML "$PLUGINSDIR\task.xml"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "The agent could not be set to start with Windows: $1"
  ${EndIf}
  nsExec::Exec 'schtasks /Run /TN "${TASK}"'

  WriteRegStr HKLM "${REGKEY}" "DisplayName" "${NAME}"
  WriteRegStr HKLM "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${REGKEY}" "Publisher" "DinePOS"
  WriteRegStr HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${REGKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'schtasks /End /TN "${TASK}"'
  nsExec::Exec 'schtasks /Delete /F /TN "${TASK}"'
  Sleep 1000
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\agent.mjs"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  ; the key and the logs go too (remove the agent in DinePOS as well)
  RMDir /r "$APPDATA\DinePOS Print Agent"
  DeleteRegKey HKLM "${REGKEY}"
SectionEnd
