@echo off
rem Nabava Orodjarna - odstranitev obvestil s tega PC-ja
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo Ne najdem Windows PowerShell.
  pause
  exit /b 1
)
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0paket\obvestila\odstrani-obvestila.ps1"
exit /b 0
