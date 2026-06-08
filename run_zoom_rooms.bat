@echo off
cd /d "%~dp0"

npm start

if errorlevel 1 (
  echo Zoom breakout room setup failed.
  echo Please check logs and output\result.json.
  exit /b 1
) else (
  echo Zoom breakout room setup succeeded.
  exit /b 0
)
