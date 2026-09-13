@echo off
chcp 65001 >nul
title 视频快译 · 一键打包
cd /d "%~dp0"
echo 正在打包 视频快译 Windows 安装包……
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build.ps1"
echo.
pause
