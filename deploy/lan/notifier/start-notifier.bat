@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo Ne najdem Windows PowerShell.
  pause
  exit /b 1
)

echo Zaganjam Nabava notifier v ozadju...
echo To okno lahko ZAPRES — toasti ostanejo.
echo Zaustavi v Task Manager: powershell.exe (NabavaNotifier)
echo.

start "NabavaNotifier" /MIN "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0nabava-notifier.ps1"
timeout /t 2 /nobreak >nul
echo Zagnano. Zapri to okno.
pause
