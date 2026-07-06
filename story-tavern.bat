@echo off
rem ============================================================================
rem  Story Tavern launcher
rem
rem  Double-click to run the app. It launches the built app directly via Electron
rem  (no `npm start`, no dev server).
rem
rem  Usage:
rem    story-tavern.bat          Launch the current build (builds once if missing).
rem    story-tavern.bat build    Rebuild first, then launch (use after code changes).
rem ============================================================================

rem Run from this script's own folder so double-clicking works from anywhere.
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. See the errors above.
    pause
    exit /b 1
  )
)

set "REBUILD="
if /I "%~1"=="build" set "REBUILD=1"
if not exist "out\renderer\index.html" set "REBUILD=1"

if defined REBUILD (
  echo Building Story Tavern...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed. See the errors above.
    pause
    exit /b 1
  )
)

echo Starting Story Tavern...
call "node_modules\.bin\electron.cmd" .
