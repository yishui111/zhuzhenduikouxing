@echo off
rem ============================================================
rem  light-avatar - stop
rem  Kills the process listening on the configured port.
rem  Uses the same PORT as start.bat (default 48625).
rem ============================================================
setlocal
if not defined PORT set "PORT=48625"

echo Stopping light-avatar server on port %PORT% ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% " ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
echo Done. If the server window is still open, just close it.

endlocal
exit /b 0
