@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo [NeuroTeam] Running automated tests...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_team_tests.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [NeuroTeam] Tests completed successfully.
) else (
  echo [NeuroTeam] Tests failed with exit code %RC%.
)
pause
exit /b %RC%
