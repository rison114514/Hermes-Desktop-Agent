@echo off
setlocal

cd /d "%~dp0"

if "%HERMES_WSL_DISTRO%"=="" (
  if not "%~1"=="" (
    if /i "%~1"=="-Distro" (
      if not "%~2"=="" (
        set "HERMES_WSL_DISTRO=%~2"
      )
    ) else if /i "%~1"=="Ubuntu-24.04" (
      set "HERMES_WSL_DISTRO=Ubuntu-24.04"
    ) else if /i "%~1"=="Ubuntu-22.04" (
      set "HERMES_WSL_DISTRO=Ubuntu-22.04"
    ) else if /i "%~1"=="Ubuntu" (
      set "HERMES_WSL_DISTRO=Ubuntu"
    )
  )
)

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  set "PS_EXE=pwsh.exe"
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo ========================================================
  echo Hermes Desktop Agent failed to start.
  echo.
  echo If your WSL distro name is different, try:
  echo   - Set env var first: set HERMES_WSL_DISTRO=YourDistroName
  echo   - Or use parameter: %~nx0 -Distro YourDistroName
  echo.
  echo Common distro names: Ubuntu-24.04, Ubuntu-22.04, Ubuntu
  echo ========================================================
  echo.
  echo Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
