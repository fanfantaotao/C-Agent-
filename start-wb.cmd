@echo off
setlocal
cd /d "%~dp0"
title MushSCI prototype - click-to-edit bridge

rem ---------------------------------------------------------------------------
rem  Portable launcher for the prototype + wb-bridge (AI click-to-edit).
rem  Requirements on this computer: Node.js 18+ and network access on first run.
rem  Everything else (React, Vite, Babel) is installed from package-lock.json.
rem  ASCII only on purpose: cmd.exe garbles non-ASCII in .cmd files.
rem ---------------------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 goto :nonode
where npm >nul 2>nul
if errorlevel 1 goto :nonpm

if not exist "node_modules\vite\bin\vite.js" (
  echo.
  echo   First run on this computer: installing dependencies ^(about 80 MB^)...
  echo.
  call npm ci
  if errorlevel 1 (
    echo   npm ci failed, retrying with npm install...
    call npm install
    if errorlevel 1 goto :depfail
  )
)

echo.
echo   prototype  : http://127.0.0.1:5180/
echo   bridge API : http://127.0.0.1:5180/__wb__/api/health
echo   queue file : .wb-bridge\session.json
echo.
echo   Keep this window open. Click elements in the page, then let the AI agent
echo   that has this project open process the queue. Ctrl+C stops the server.
echo.

rem open the browser after the server has had a moment to boot
start "wb-open" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:5180/"

call npm run dev:bridge
echo.
echo   Server stopped.
pause
exit /b 0

:nonode
echo.
echo   Node.js was not found on this computer.
echo   Install Node 18 or newer from https://nodejs.org/ and run this file again.
echo.
pause
exit /b 1

:nonpm
echo.
echo   npm was not found. Reinstall Node.js ^(npm ships with it^).
echo.
pause
exit /b 1

:depfail
echo.
echo   Could not install dependencies. Check the network, then run this file again.
echo   Manual fallback:  npm ci   then   npm run dev:bridge
echo.
pause
exit /b 1
