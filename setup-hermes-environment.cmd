@echo off
setlocal

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

cd /d "%~dp0"

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  set "PS_EXE=pwsh.exe"
)

echo ============================================
echo  Hermes Desktop Agent - Native Setup
echo ============================================
echo.
echo This will install Hermes Agent natively on Windows.
echo No WSL / Docker / Hyper-V required.
echo.
echo Press any key to start, or close this window to cancel.
pause >nul

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows-env.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Native Hermes setup failed. Exit code: %EXIT_CODE%
  echo Check the message above, then press any key to close this window.
  pause >nul
) else (
  echo.
  echo Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
