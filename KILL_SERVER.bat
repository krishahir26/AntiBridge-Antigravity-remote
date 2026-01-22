@echo off
REM ========================================
REM Kill Server on Port 8000
REM ========================================

echo.
echo ========================================
echo  Kill Server on Port 8000
echo ========================================
echo.

REM Check if port 8000 is in use
echo [1/3] Checking port 8000...
netstat -ano | findstr :8000 > nul
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Port 8000 is not in use. No server to kill.
    echo.
    pause
    exit /b 0
)

echo [OK] Port 8000 is in use.
echo.

REM Find PID using port 8000
echo [2/3] Finding process ID...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    set PID=%%a
)

if "%PID%"=="" (
    echo [ERROR] Could not find PID for port 8000
    pause
    exit /b 1
)

echo [OK] Found PID: %PID%
echo.

REM Display process info
echo [INFO] Process details:
tasklist | findstr %PID%
echo.

REM Kill the process
echo [3/3] Killing process %PID%...
taskkill /PID %PID% /F

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  SUCCESS! Server killed successfully.
    echo ========================================
) else (
    echo.
    echo ========================================
    echo  ERROR! Failed to kill server.
    echo  Try running as Administrator.
    echo ========================================
)

echo.
echo [Final Check] Verifying port 8000...
timeout /t 2 /nobreak > nul
netstat -ano | findstr :8000
if %errorlevel% neq 0 (
    echo [OK] Port 8000 is now free!
) else (
    echo [WARNING] Port 8000 is still in use!
)

echo.
pause
