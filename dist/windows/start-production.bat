@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PORT=10101"
set "APP_ROOT=%ROOT%"
set "FRONTEND_DIR=%ROOT%\frontend\dist"
set "CORS_ORIGIN=*"
echo Open http://localhost:10101/AllocateAntivirus/
cd /d "%ROOT%"
"%ROOT%\allocate-antivirus-backend.exe"
endlocal
