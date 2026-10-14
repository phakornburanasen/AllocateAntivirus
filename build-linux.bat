@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\dist\linux"

echo Building frontend...
cd /d "%ROOT%\frontend" || exit /b 1
if not exist node_modules call npm.cmd install || exit /b 1
call npm.cmd run build || exit /b 1

echo Building Linux backend executable...
cd /d "%ROOT%\backend" || exit /b 1
if not exist "%OUT%" mkdir "%OUT%"
set "GOOS=linux"
set "GOARCH=amd64"
set "CGO_ENABLED=0"
go build -ldflags "-s -w" -o "%OUT%\allocate-antivirus-backend" . || exit /b 1

echo Copying frontend dist...
if exist "%OUT%\frontend\dist" rmdir /s /q "%OUT%\frontend\dist"
mkdir "%OUT%\frontend" >nul 2>nul
robocopy "%ROOT%\frontend\dist" "%OUT%\frontend\dist" /MIR >nul
if errorlevel 8 exit /b 1

if not exist "%OUT%\uploads\imgs" mkdir "%OUT%\uploads\imgs"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p='%ROOT%\build-linux-start-production.sh';$o='%OUT%\start-production.sh';$c=[IO.File]::ReadAllText($p);[IO.File]::WriteAllText($o,($c -replace [char]13+[char]10,[char]10),(New-Object Text.UTF8Encoding($false)))" || exit /b 1

echo.
echo Build complete:
echo %OUT%\allocate-antivirus-backend
echo %OUT%\start-production.sh
endlocal
