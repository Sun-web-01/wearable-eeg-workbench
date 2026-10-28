@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo [NeuroTeam] Running tests and generating a reproducible demo report...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_acceptance.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [NeuroTeam] Acceptance run completed successfully.
  echo [NeuroTeam] Open the newest report under reports\runs.
) else (
  echo [NeuroTeam] Acceptance run failed with exit code %RC%.
)
pause
exit /b %RC%
