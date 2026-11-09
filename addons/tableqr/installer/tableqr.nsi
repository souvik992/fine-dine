; Installer for the Table QR add-on. Built by scripts/installer.mjs (makensis from electron-builder's cache).
; Installs the signed package next to DinePOS's data on the main PC (the PC whose DinePOS runs the outlet server):
;   %ProgramData%\DinePOS\addons\tableqr\   (DinePOS checks the signature and every file before loading it)
; Defines passed in: VERSION, SRC (built package folder), OUTFILE, and ICON when DinePOS has one.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define NAME "DinePOS - Table QR"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DinePOS-TableQR"

Name "${NAME}"
OutFile "${OUTFILE}"
; the folder is set in .onInit: C:\ProgramData is $APPDATA once the shell context is "all users"
BrandingText "DinePOS"
!ifdef ICON
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
!endif
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Table QR for DinePOS"
!define MUI_WELCOMEPAGE_TEXT "This adds table QR ordering to DinePOS:$\r$\n$\r$\n- guests scan the code on their table to see the menu and order$\r$\n- call a waiter, ask for the bill, see the running bill$\r$\n- pay a printed bill by UPI (the cashier confirms)$\r$\n- Settings > Table QR: switch on, accepting, print the codes$\r$\n$\r$\nRun it on the main PC (where DinePOS runs the outlet server). Your bills and data are not changed."
!define MUI_FINISHPAGE_TITLE "Table QR is installed"
!define MUI_FINISHPAGE_TEXT "Close DinePOS on this PC and open it again. Then switch Table QR on in Settings > Table QR and print the codes."
!insertmacro MUI_PAGE_WELCOME
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

Function .onInit
  SetShellVarContext all
  StrCpy $INSTDIR "$APPDATA\DinePOS\addons\tableqr"
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  ; DinePOS (per-machine install) must be on this PC
  ${IfNot} ${FileExists} "$PROGRAMFILES64\DinePOS\DinePOS.exe"
    MessageBox MB_ICONSTOP|MB_OK "Install DinePOS on this PC first (the main PC that runs the outlet server), then run this installer again." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext all
  StrCpy $INSTDIR "$APPDATA\DinePOS\addons\tableqr"
  ; the same registry view as the installer (.onInit), or DeleteRegKey misses the entry and Windows keeps listing Table QR
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
FunctionEnd

Section "Table QR"
  SetOutPath "$INSTDIR"
  ; remove the old signature first and write the new one last: DinePOS never sees a half-copied package as valid
  Delete "$INSTDIR\manifest.json"
  File "${SRC}\backend.cjs"
  SetOutPath "$INSTDIR\ui"
  File "${SRC}\ui\ui.js"
  File "${SRC}\ui\ui.css"
  SetOutPath "$INSTDIR\web"
  File "${SRC}\web\index.html"
  File "${SRC}\web\app.js"
  File "${SRC}\web\app.css"
  SetOutPath "$INSTDIR"
  File "${SRC}\manifest.json"
  WriteUninstaller "$INSTDIR\uninstall.exe"
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
  ; signature first, so DinePOS stops loading it at the next start; its settings, codes and history stay in the DinePOS data
  Delete "$INSTDIR\manifest.json"
  Delete "$INSTDIR\backend.cjs"
  Delete "$INSTDIR\ui\ui.js"
  Delete "$INSTDIR\ui\ui.css"
  RMDir "$INSTDIR\ui"
  Delete "$INSTDIR\web\index.html"
  Delete "$INSTDIR\web\app.js"
  Delete "$INSTDIR\web\app.css"
  RMDir "$INSTDIR\web"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${REGKEY}"
SectionEnd
