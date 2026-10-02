@echo off
REM Double-click this file to start OpenStatsEngine on Windows.
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
  echo   Your Node version is too old - OpenStatsEngine needs Node 18 or newer.
  pause
  exit /b 1
)

REM A git checkout can update itself. Ask, and start anyway after 15 seconds so a
REM machine left unattended before a game still comes up on the version it had.
if not exist .git goto start
where git >nul 2>nul
if errorlevel 1 goto start
git fetch --quiet 2>nul
if errorlevel 1 goto start
set BEHIND=0
for /f %%n in ('git rev-list --count HEAD..@{u} 2^>nul') do set BEHIND=%%n
if "%BEHIND%"=="0" goto start
echo.
echo   An update is available (%BEHIND% new commits).
choice /c YN /t 15 /d N /m "  Update now"
if errorlevel 2 goto start
git pull --ff-only
if errorlevel 1 echo   Update failed - starting the current version.

:start
echo Starting OpenStatsEngine...
echo.
echo If Windows Defender Firewall asks, click "Allow access" on PRIVATE networks
echo so tablets and phones on your Wi-Fi can reach the entry page.
echo.
node server.js %*
echo.
echo Server stopped.
pause
