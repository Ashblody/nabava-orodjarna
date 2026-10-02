@echo off
rem Nabava Orodjarna - namestitev STREZNIKA (samo enkrat, na PC Oro455 / 192.168.1.124)
setlocal
cd /d "%~dp0"
if not exist "%~dp0paket\streznik\server\index.js" (
  echo Najprej razsiri ZIP: desni klik na ZIP, potem Razsiri vse. Nato znova dvoklikni.
  pause
  exit /b 1
)
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo Ne najdem Windows PowerShell.
  pause
  exit /b 1
)
echo Namescam streznik, prosim pocakaj...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0paket\streznik\namesti-streznik.ps1"
if errorlevel 1 (
  echo.
  echo Nekaj ni uspelo. Preberi sporocilo na zaslonu ali C:\NabavaOrodjarna\namesti.log
  pause
  exit /b 1
)
exit /b 0
