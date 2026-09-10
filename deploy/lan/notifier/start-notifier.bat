@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Zaganjam Nabava Orodjarna notifier (Windows toast)...
echo Konfiguracija: notifier-config.json
echo Zaustavi: zapri to okno ali Task Manager → powershell.exe (ta skripta)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nabava-notifier.ps1"
pause
