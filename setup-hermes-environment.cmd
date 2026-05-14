@echo off
setlocal

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "LANG=C.UTF-8"
set "LC_ALL=C.UTF-8"
set "HERMES_TEXT_ENCODING=utf-8"

cd /d "%~dp0"

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  set "PS_EXE=pwsh.exe"
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows-env.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Hermes environment setup failed. Exit code: %EXIT_CODE%
  echo Check the message above, then press any key to close this window.
  pause >nul
) else (
  echo.
  echo Hermes environment setup completed. Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
