@echo off
setlocal

chcp 65001 >/dev/null
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

cd /d "%~dp0"

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  set "PS_EXE=pwsh.exe"
)

echo ============================================
echo  Hermes Desktop Agent
echo ============================================
echo.
echo Starting Hermes Desktop with native Windows backend.
echo.
echo Prerequisites:
echo   - Node.js 20+ and npm
echo   - Hermes Agent (run setup-hermes-environment.cmd first if not installed)
echo.
echo Press any key to start, or close this window to cancel.
pause >/dev/null

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Hermes Desktop failed to start. Exit code: %EXIT_CODE%
  echo.
echo Troubleshooting:
echo   1. Run setup-hermes-environment.cmd to install Hermes Agent
echo   2. Verify Node.js is installed: node --version
echo   3. Verify npm dependencies: npm install
  echo.
  echo Press any key to close this window.
  pause >/dev/null
) else (
  echo.
  echo Hermes Desktop has exited.
  echo Press any key to close this window.
  pause >/dev/null
)

exit /b %EXIT_CODE%
