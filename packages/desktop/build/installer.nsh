; Copyright © 2025–2026 Dankest, LLC
; Based on XChain Platform by Dankest, LLC – https://dankest.llc
;
; SPDX-License-Identifier: AGPL-3.0-or-later
;
; This file is part of XChain Platform. Licensed under the GNU Affero
; General Public License v3.0 or later; see LICENSE.md. A commercial
; license (without AGPL source-disclosure terms) is available -
; contact legal@dankest.llc.

; NSIS hooks for the Windows installer and uninstaller. electron-builder
; includes this file through `nsis.include` (electron-builder.config.cjs)
; and inserts each macro at the point its name names; the hook points
; quoted below are app-builder-lib 26.15.7's templates/nsis, and
; test/smoke/audits/desktop-nsis-hooks.smoke.js fails if they move.

; --- Shortcuts are rewritten on every install, updates included ---------
;
; v0.343.0 wrote a 318-character description into each shortcut. Windows
; caps a shortcut comment at 260 characters, and the overflow corrupted
; the rest of the .lnk: its icon location decoded as `rogram Files
; (x86)\...`, so the desktop and Start-menu icons, and the taskbar button
; that borrows the Start-menu one, were blank.
;
; Fixing the description does not repair those files. An in-app update
; runs the installer with --updated, and with
; allowToChangeInstallationDirectory set, setIsTryToKeepShortcuts keeps
; isTryToKeepShortcuts "true"; the previous install wrote KeepShortcuts
; and $appExe exists, so addStartMenuLink and addDesktopLink skip
; CreateShortCut and the broken files survive the update untouched.
;
; customInstall runs after both of those macros (installSection.nsh), so
; this rewrites only the shortcuts that already exist: it never recreates
; one a user deleted. The arguments are the template's own, so a fresh
; install's shortcut and a repaired one are the same file. SetLnkAUMI
; stamps the AppUserModelID the running app claims
; (main/appUserModelId.js), which is what lets the taskbar match its
; button to the pinned or Start-menu shortcut. SHCNE_ASSOCCHANGED makes
; Explorer drop the blank icons it cached.
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; --- An arm64 all-users install goes to Program Files ------------------
;
; multiUser.nsh's setInstallModePerAllUsers picks $PROGRAMFILES64 only
; under `!ifdef APP_64`. Each of our installers carries one arch
; (nsis.buildUniversalInstaller false), so the arm64 one defines
; APP_ARM64 alone and a per-machine install landed in
; `C:\Program Files (x86)\XChain Wallet`, the folder for 32-bit x86 apps,
; for a native arm64 program.
;
; WHY THIS HOOK. setInstallModePerAllUsers runs again inside the install
; section for a silent per-machine install, after customInit and every
; other init hook, and resets $INSTDIR; a page callback never runs under
; /S. handleUninstallResult is the one hook inside the section after that
; reset and before `SetOutPath $INSTDIR` and the file copy
; (installSection.nsh), and customUnInstallCheck is how it is reached. Its
; price is that defining it replaces the template's own check of the old
; uninstaller's result, so that check is restated below unchanged.
;
; WHEN IT MOVES THE FOLDER. Only for a fresh per-machine install on a
; native arm64 machine still aimed at the template's default: no
; per-machine InstallLocation was stored and $INSTDIR is exactly
; `$PROGRAMFILES\${APP_FILENAME}`. An existing install, including a
; v0.343.0 one in Program Files (x86), keeps its stored InstallLocation:
; moving a live install would strand the user's pinned shortcuts and any
; path a tool recorded, for a cosmetic gain. A /D= path is left alone
; too. The interactive directory page still shows the x86 default before
; this runs (no hook exists between the mode page and that page); the
; files land in Program Files either way.
!macro customUnInstallCheck
  Var /GLOBAL xcOldUninstallerFailedToLaunch
  StrCpy $xcOldUninstallerFailedToLaunch "0"
  IfErrors 0 +2
    StrCpy $xcOldUninstallerFailedToLaunch "1"

  !ifdef APP_ARM64
    !ifndef APP_64
      ${if} $installMode == "all"
      ${andIf} $perMachineInstallationFolder == ""
      ${andIf} $INSTDIR == "$PROGRAMFILES\${APP_FILENAME}"
      ${andIf} ${IsNativeARM64}
        StrCpy $INSTDIR "$PROGRAMFILES64\${APP_FILENAME}"
        StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        DetailPrint `Native arm64 all-users install: $INSTDIR`
      ${endIf}
    !endif
  !endif

  ; The template's handleUninstallResult body, restated (installUtil.nsh).
  ${if} $xcOldUninstallerFailedToLaunch == "1"
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    Return
  ${endIf}
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endIf}
!macroend

; --- Uninstall removes the URL handlers the app registered -------------
;
; The app claims xchain: (and, when the user opts in, bitcoin:, litecoin:
; and dogecoin:) at runtime with setAsDefaultProtocolClient
; (main/protocol.js), under HKCU\Software\Classes. Nothing removed them, so
; after an uninstall xchain: still pointed at an exe that no longer
; existed, and the coin schemes the app declined were left as empty keys
; holding only `URL Protocol` and `SharedHostApplication` values.
;
; A key goes only when it is ours: its open command starts with this
; install's own folder, or it is an empty shell that registers no handler
; at all (no command, no default value, no subkey, and no value but those
; two). A handler another wallet registered is left exactly as it is.
;
; Skipped when ${isUpdated}: the installer runs the previous version's
; uninstaller with --updated on every update and every reinstall
; (installUtil.nsh uninstallOldVersion), and the handlers must survive
; those.
!macro xcRemoveOwnUrlHandler SCHEME
  StrCpy $R1 "Software\Classes\${SCHEME}"
  ClearErrors
  ReadRegStr $R2 HKCU "$R1\shell\open\command" ""
  ${if} $R2 != ""
    ; Electron writes `"<exe>" "%1"`: compare the quoted folder prefix.
    StrLen $R4 "$\"$INSTDIR\"
    StrCpy $R3 $R2 $R4
    ${if} $R3 == "$\"$INSTDIR\"
      DeleteRegKey HKCU "$R1"
      DetailPrint `Removed the ${SCHEME}: handler this install registered`
    ${endIf}
  ${else}
    ; No command. An empty shell has no subkey, no default value, and no
    ; value but `URL Protocol` and `SharedHostApplication` (Windows adds
    ; the latter, "!", to these keys: measured on both test VMs on
    ; v0.343.0). Any other value or a subkey means someone else's data.
    ClearErrors
    EnumRegKey $R3 HKCU "$R1" 0
    ${ifNot} ${Errors}
    ${andIf} $R3 == ""
      ReadRegStr $R2 HKCU "$R1" ""
      ${if} $R2 == ""
        StrCpy $R4 "empty"
        StrCpy $R5 0
        ${Do}
          EnumRegValue $R3 HKCU "$R1" $R5
          ${if} $R3 != ""
          ${andIf} $R3 != "URL Protocol"
          ${andIf} $R3 != "SharedHostApplication"
            StrCpy $R4 "foreign"
          ${endIf}
          IntOp $R5 $R5 + 1
        ${LoopUntil} $R5 > 31
        ${if} $R4 == "empty"
          DeleteRegKey HKCU "$R1"
          DetailPrint `Removed the empty ${SCHEME}: key the app left`
        ${endIf}
      ${endIf}
    ${endIf}
  ${endIf}
  ClearErrors
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    !insertmacro xcRemoveOwnUrlHandler "xchain"
    !insertmacro xcRemoveOwnUrlHandler "bitcoin"
    !insertmacro xcRemoveOwnUrlHandler "litecoin"
    !insertmacro xcRemoveOwnUrlHandler "dogecoin"
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
  ${endIf}
!macroend
