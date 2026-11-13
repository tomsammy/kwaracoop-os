@echo off
title KwaraCoop OS - Ministry Demonstration Launcher
color 0A

echo =====================================================================
echo  KWARA STATE COOPERATIVE MANAGEMENT SYSTEM (KWARA-COOP OS)
echo  Ministry of Business, Innovation and Technology
echo =====================================================================
echo.
echo Starting demonstration environment...

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found. Attempting to start via Docker...
    docker-compose up -d
    timeout /t 3 >nul
    start http://localhost:3000/
    exit /b
)

:: Launch the server and open browser
echo [OK] Launching KwaraCoop Platform Server...
start "" node server.js
timeout /t 2 >nul

echo [OK] Opening Demonstration Suite in your default browser...
start http://localhost:3000/

echo.
echo =====================================================================
echo  DEMO IS RUNNING LIVE AT: http://localhost:3000/
echo  Close this window when finished with the demonstration.
echo =====================================================================
pause
