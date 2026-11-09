@echo off
REM Double-click this file to start StatPop on Windows.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS installer from https://nodejs.org and run it,
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 18 (
  echo   Your Node version is too old - StatPop needs Node 18 or newer.
  pause
  exit /b 1
)

node server.js --open %*
pause
