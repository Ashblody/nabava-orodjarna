@echo off
rem Nabava Orodjarna - namestitev obvestil na ta PC (vsak PC enkrat, brez admina)
setlocal
cd /d "%~dp0"
if not exist "%~dp0paket\obvestila\nabava-obvestila.ps1" (
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
echo Namescam obvestila, prosim pocakaj...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0paket\obvestila\namesti-obvestila.ps1"
if errorlevel 1 (
  echo.
  echo Nekaj ni uspelo. Preberi sporocilo na zaslonu.
  echo Zapis: %LOCALAPPDATA%\NabavaOrodjarna\notifier.log
  pause
  exit /b 1
)
exit /b 0
