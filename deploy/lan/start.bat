@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0runtime\node\node.exe" (
  echo MANJKA: runtime node node.exe
  pause
  exit /b 1
)
if not exist "%~dp0dist\index.html" (
  echo MANJKA: dist index.html
  pause
  exit /b 1
)
if not exist "%~dp0server\index.js" (
  echo MANJKA: server index.js
  pause
  exit /b 1
)
if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%~dp0start-hidden.vbs" (
  echo MANJKA: start-hidden.vbs
  pause
  exit /b 1
)

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Streznik ze tece SKRITO na 8787.
  echo Odpri: http://192.168.1.124:8787/
  echo Zaustavi: taskkill /IM node.exe /F
  pause
  exit /b 0
)

echo Zaganjam SKRITO v ozadju (ni v orodni vrstici).
echo Odpri: http://192.168.1.124:8787/
echo Zaustavi: taskkill /IM node.exe /F
echo.

wscript //nologo "%~dp0start-hidden.vbs"
timeout /t 2 /nobreak >nul
echo Zagnano skrito. To okno lahko zapres.
pause
exit /b 0
