; 视频快译 · NSIS 定制脚本
; 需求：安装完成后，安装包（setup.exe）自动删除自身

!include "Windows.nsh"

!macro customInstall
  ; 写一个临时批处理：等安装进程退出后循环尝试 del 安装包，成功后自删批处理
  FileOpen $0 "$TEMP\vts-self-delete.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'ping 127.0.0.1 -n 3 >nul 2>nul$\r$\n'
  FileWrite $0 ':vts_retry$\r$\n'
  FileWrite $0 'del /f /q "$EXEPATH" 2>nul$\r$\n'
  FileWrite $0 'if exist "$EXEPATH" (ping 127.0.0.1 -n 2 >nul 2>nul & goto vts_retry)$\r$\n'
  FileWrite $0 '(goto) 2>nul & del "%~f0"$\r$\n'
  FileClose $0
  ; 隐藏窗口后台执行；安装包在程序 Files/Downloads 任意路径都适用
  ExecShell "" "$TEMP\vts-self-delete.bat" "" "" ${SW_HIDE}
!macroend
