@echo off
rem Nabava Orodjarna - ustavi streznik in odstrani samodejni zagon (podatki ostanejo)
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo Ne najdem Windows PowerShell.
  pause
  exit /b 1
)
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0paket\streznik\odstrani-streznik.ps1"
exit /b 0
