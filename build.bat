@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\dist\windows"

echo Building frontend...
cd /d "%ROOT%\frontend" || exit /b 1
if not exist node_modules call npm install || exit /b 1
call npm run build || exit /b 1

echo Building Windows backend executable...
cd /d "%ROOT%\backend" || exit /b 1
if not exist "%OUT%" mkdir "%OUT%"
go build -ldflags "-s -w" -o "%OUT%\allocate-antivirus-backend.exe" . || exit /b 1

echo Copying frontend dist...
if exist "%OUT%\frontend\dist" rmdir /s /q "%OUT%\frontend\dist"
mkdir "%OUT%\frontend" >nul 2>nul
robocopy "%ROOT%\frontend\dist" "%OUT%\frontend\dist" /MIR >nul
if errorlevel 8 exit /b 1

if not exist "%OUT%\uploads\imgs" mkdir "%OUT%\uploads\imgs"

(
  echo @echo off
  echo setlocal
  echo set "ROOT=%%~dp0"
  echo set "ROOT=%%ROOT:~0,-1%%"
  echo set "PORT=10101"
  echo set "APP_ROOT=%%ROOT%%"
  echo set "FRONTEND_DIR=%%ROOT%%\frontend\dist"
  echo set "UPLOAD_DIR=%%ROOT%%\uploads\imgs"
  echo set "CORS_ORIGIN=*"
  echo echo Open http://localhost:10101/AllocateAntivirus/
  echo cd /d "%%ROOT%%"
  echo "%%ROOT%%\allocate-antivirus-backend.exe"
  echo endlocal
) > "%OUT%\start-production.bat"

echo.
echo Build complete:
echo %OUT%\allocate-antivirus-backend.exe
echo %OUT%\start-production.bat
endlocal
