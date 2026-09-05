@echo off
rem ============================================================
rem  light-avatar (frame lip-sync digital human) - start
rem  Requires: Node.js >= 20
rem  Starts the local server and opens the main page in browser.
rem  Port: env PORT or 48625 (e.g. set PORT=9090 before start).
rem ============================================================
setlocal
cd /d "%~dp0"

if not defined PORT set "PORT=48625"

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo [ERROR] Node.js not found. Please install Node.js 20 or newer:
  echo         https://nodejs.org
  echo         Then run this script again.
  pause
  exit /b 1
)

cd /d "%~dp0code"
start "light-avatar-server" cmd /k ""%NODE%" server.mjs %PORT%"

rem wait a moment for the server to listen, then open the main page
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/web/index.html"

endlocal
exit /b 0
