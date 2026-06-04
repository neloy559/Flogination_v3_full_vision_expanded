@echo off
title Flogination V5 — Launcher
color 0A

echo.
echo  ==========================================
echo   FLOGINATION V5.0.0
echo   Elite Facebook Session Manager
echo  ==========================================
echo.
echo  Starting API server on port 3001...
echo  Starting Dashboard on port 3000...
echo.

set PROJECT=D:\1 My Dev Creations\Session Manager (FB)\FLogination - The Session Manager

:: Start API server in its own window
start "Flogination API :3001" cmd /k "cd /d "%PROJECT%" && npx tsx src/server/index.ts"

:: Start Next.js UI in its own window
start "Flogination UI :3000" cmd /k "cd /d "%PROJECT%" && npx next dev Flogination/flogination-web"

:: Wait for Next.js to be ready (usually 10-15s), then open browser
echo  Waiting for servers to start...
timeout /t 15 /nobreak > nul

:: Open dashboard in default browser
start "" "http://localhost:3000"

echo  Done! Dashboard opened at http://localhost:3000
echo.
echo  To stop: close the two server windows.
echo.
pause
