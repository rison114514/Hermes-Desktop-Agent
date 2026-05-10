@echo off
setlocal

cd /d "%~dp0"

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  set "PS_EXE=pwsh.exe"
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Hermes Desktop Agent failed to start. Exit code: %EXIT_CODE%
  echo Check the message above, then press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
