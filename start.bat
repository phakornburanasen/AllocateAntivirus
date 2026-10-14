@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-dev.ps1"

echo.
echo Frontend: http://localhost:3000/AllocateAntivirus/
echo Backend : http://localhost:10101
echo.
echo Use stop.bat to stop both services.
endlocal
