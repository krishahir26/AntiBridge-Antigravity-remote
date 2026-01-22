@echo off
echo ========================================
echo   AntiBridge v3.0.0 - Full Start
echo ========================================
echo.
echo Step 1: Opening Antigravity with CDP...
cscript //nologo "%~dp0OPEN_ANTIGRAVITY_CDP.vbs"
echo   Antigravity started (silent)

echo.
echo Waiting 5 seconds for Antigravity to start...
timeout /t 5 /nobreak >nul

echo.
echo Step 2: Starting Backend Server...
start "AntiBridge Server" cmd /k "cd /d %~dp0backend && npm start"

echo.
echo Waiting 3 seconds for server to start...
timeout /t 3 /nobreak >nul

echo.
echo Step 3: Opening Web UI...
start http://localhost:8000

echo.
echo ========================================
echo   All components started!
echo ========================================
echo.
echo   Antigravity: localhost:9000 (CDP)
echo   Server:      localhost:8000
echo   Web UI:      http://localhost:8000
echo.
echo Press any key to close this window...
pause >nul
