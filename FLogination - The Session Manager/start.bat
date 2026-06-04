@echo off
title Flogination V5 - Launcher
color 0A

echo.
echo  ==========================================
echo   Flogination V5.0.0 - Starting...
echo  ==========================================
echo.

:: Kill anything on port 3000 and 3001 first
echo [1/3] Clearing ports 3000 and 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

:: Start API server in a new window
echo [2/3] Starting API server on port 3001...
start "Flogination API" cmd /k "cd /d "%~dp0" && npx tsx src/server/index.ts"

:: Wait for API to be ready
echo [3/3] Waiting for API server to start...
timeout /t 5 /nobreak >nul

:: Start Next.js UI in a new window
echo [4/4] Starting UI on port 3000...
start "Flogination UI" cmd /k "cd /d "%~dp0" && npx next dev Flogination/flogination-web"

:: Wait for UI to compile
echo.
echo  Waiting for UI to compile (15 seconds)...
timeout /t 15 /nobreak >nul

:: Open browser
echo  Opening browser...
start "" "http://localhost:3000"

echo.
echo  ==========================================
echo   Flogination is running!
echo   API  -> http://localhost:3001
echo   UI   -> http://localhost:3000
echo  ==========================================
echo.
echo  Close the API and UI windows to stop.
echo.
pause
