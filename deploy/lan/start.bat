@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "runtime\node\node.exe" (
  echo.
  echo MANJKA portable Node.js:
  echo   pricakovana pot: runtime\node\node.exe
  echo Glej NAVODILA-LAN.md / README.md.
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo Manjka mapa dist\ z zgrajeno aplikacijo.
  pause
  exit /b 1
)

if not exist "server\index.js" (
  echo Manjka server\index.js
  pause
  exit /b 1
)

if not exist "data" mkdir data

set NABAVA_DATA_DIR=%~dp0data
set PORT=8787

echo Zaganjam Nabava Orodjarna LAN streznik...
echo   Podatki: %NABAVA_DATA_DIR%
echo   Odpri v brskalniku: http://192.168.1.50:8787/  (ali IP tega PC-ja)
echo   Zaustavi z Ctrl+C
echo.

"runtime\node\node.exe" "server\index.js"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" echo Streznik se je ustavil z napako %ERR%.
pause
exit /b %ERR%
