@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "RUNTIME=%ROOT%\.runtime"

if exist "%RUNTIME%\frontend.pid" (
  for /f %%p in (%RUNTIME%\frontend.pid) do taskkill /PID %%p /T /F >nul 2>nul
  del "%RUNTIME%\frontend.pid" >nul 2>nul
)

if exist "%RUNTIME%\backend.pid" (
  for /f %%p in (%RUNTIME%\backend.pid) do taskkill /PID %%p /T /F >nul 2>nul
  del "%RUNTIME%\backend.pid" >nul 2>nul
)

echo AllocateAntivirus services stopped.
endlocal
exit /b 0
