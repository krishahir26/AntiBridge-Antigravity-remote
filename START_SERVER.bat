@echo off
echo ========================================
echo   AntiBridge v3.0.0 - Start Server
echo ========================================
echo.

cd /d "%~dp0backend"

echo Installing dependencies...
call npm install --silent

echo.
echo Starting server...
echo.
call npm start
