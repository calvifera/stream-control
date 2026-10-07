@echo off
title Stream Control setup
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org,
  echo install it with the default options, then double-click this file again.
  echo.
  pause
  exit /b 1
)
node scripts\setup.mjs
echo.
pause
