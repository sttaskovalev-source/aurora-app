@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Aurora] Node.js не найден. Установите Node.js 18+ с https://nodejs.org
  pause
  exit /b 1
)
start "" /min powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://127.0.0.1:8787/'"
node server.js
pause
