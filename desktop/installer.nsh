; Nova's Windows installer: Nova Bridge gets its own Start-menu shortcut
; (the same program, started with --nova-bridge). Nova also adds it on
; first launch, for the portable .exe; uninstalling removes both copies.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Nova Bridge.lnk" "$INSTDIR\Nova.exe" "--nova-bridge" "$INSTDIR\Nova.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Nova Bridge.lnk"
  Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Nova Bridge.lnk"
!macroend
