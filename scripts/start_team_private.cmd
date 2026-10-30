@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_team_private.ps1" -Port 8000
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [NeuroTeam] Startup failed with exit code %RC%.
pause
exit /b %RC%
