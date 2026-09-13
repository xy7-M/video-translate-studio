; Video Translate Studio - NSIS customization
; Goal: the setup.exe deletes itself after successful installation.
; ASCII-only on purpose (makensis include charset).

!include "WinMessages.nsh"

!macro customInstall
  ; Write a temp batch: wait for the installer process to exit, then loop del
  ; on the setup file; finally delete the batch itself.
  FileOpen $0 "$TEMP\vts-self-delete.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'ping 127.0.0.1 -n 3 >nul 2>nul$\r$\n'
  FileWrite $0 ':vts_retry$\r$\n'
  FileWrite $0 'del /f /q "$EXEPATH" 2>nul$\r$\n'
  FileWrite $0 'if exist "$EXEPATH" (ping 127.0.0.1 -n 2 >nul 2>nul & goto vts_retry)$\r$\n'
  FileWrite $0 '(goto) 2>nul & del "%~f0"$\r$\n'
  FileClose $0
  ; Run hidden in background. Works from any download folder.
  ExecShell "open" "$TEMP\vts-self-delete.bat" "" SW_HIDE
!macroend
