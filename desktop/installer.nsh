; Optional desktop shortcut on the finish page, without administrator privileges.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Utwórz skrót Garden Manager na pulpicie"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION GMDesktopShortcut
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
Function GMDesktopShortcut
  CreateShortcut "$DESKTOP\Garden Manager.lnk" "$INSTDIR\Garden Manager.exe"
FunctionEnd
!macro customUnInstall
  Delete "$DESKTOP\Garden Manager.lnk"
!macroend
