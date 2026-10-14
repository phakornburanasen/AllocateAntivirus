@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

wsl bash -lc "cd '%ROOT:\=/%' && ./build-linux.sh"
endlocal
