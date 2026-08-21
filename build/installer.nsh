!macro customInstall
  ; Re-point shortcuts at bundled dsh icon (exe icon embedding needs admin symlinks)
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe" "" "$INSTDIR\resources\build\icon.ico"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe" "" "$INSTDIR\resources\build\icon.ico"
!macroend
